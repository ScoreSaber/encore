package com.scoresaber.encore;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import io.github.muntashirakon.adb.AbsAdbConnectionManager;
import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.IntConsumer;

public class WirelessDebugging extends BroadcastReceiver {
    static final String CONNECT_SERVICE = "_adb-tls-connect._tcp";
    static final String PAIRING_SERVICE = "_adb-tls-pairing._tcp";
    private static final String SETTINGS_PACKAGE = "com.android.settings";
    private static final long DISCOVERY_TIMEOUT_MS = 10_000;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) restore(context);
    }

    static void restore(Context context) {
        if (context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) return;
        try {
            if (Settings.Global.getInt(context.getContentResolver(), "adb_wifi_enabled", 0) != 1) {
                Settings.Global.putInt(context.getContentResolver(), "adb_wifi_enabled", 1);
            }
        } catch (RuntimeException ignored) {
        }
    }

    static String openSettings(Activity activity) {
        Bundle highlight = new Bundle();
        highlight.putString(":settings:fragment_args_key", "toggle_adb_wireless");
        Intent developer = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
            .setPackage(SETTINGS_PACKAGE)
            .putExtra(":settings:show_fragment_args", highlight)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        var resolved = developer.resolveActivity(activity.getPackageManager());
        if (resolved != null && !resolved.getClassName().endsWith("DevelopmentSettingsDisabledActivity")) {
            activity.startActivity(developer);
            return "developer-options";
        }
        activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", SETTINGS_PACKAGE, null))
            .setPackage(SETTINGS_PACKAGE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return "app-info";
    }

    static boolean pair(int port, String code, String encodedKey, String encodedCertificate) throws Exception {
        PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(encodedKey, Base64.DEFAULT)));
        Certificate certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(Base64.decode(encodedCertificate, Base64.DEFAULT)));
        try (var client = new AbsAdbConnectionManager() {
            @Override
            protected PrivateKey getPrivateKey() { return key; }

            @Override
            protected Certificate getCertificate() { return certificate; }

            @Override
            protected String getDeviceName() { return "Encore on Quest"; }
        }) {
            return client.pair("127.0.0.1", port, code);
        }
    }

    static void findPort(Context context, String serviceType, IntConsumer found, Runnable missing) {
        if (!wirelessDebuggingOn(context)) {
            missing.run();
            return;
        }
        NsdManager nsd = context.getSystemService(NsdManager.class);
        AtomicBoolean settled = new AtomicBoolean();
        NsdManager.DiscoveryListener discovery = new NsdManager.DiscoveryListener() {
            @Override
            public void onServiceFound(NsdServiceInfo service) {
                if (settled.get()) return;
                NsdManager.DiscoveryListener listener = this;
                nsd.resolveService(service, new NsdManager.ResolveListener() {
                    @Override
                    public void onServiceResolved(NsdServiceInfo resolved) {
                        if (resolved.getPort() <= 0 || !isLocal(resolved.getHost()) || !settled.compareAndSet(false, true)) return;
                        nsd.stopServiceDiscovery(listener);
                        found.accept(resolved.getPort());
                    }

                    @Override
                    public void onResolveFailed(NsdServiceInfo failed, int errorCode) {}
                });
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                if (settled.compareAndSet(false, true)) missing.run();
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {}

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onServiceLost(NsdServiceInfo service) {}

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
        };
        nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discovery);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!settled.compareAndSet(false, true)) return;
            nsd.stopServiceDiscovery(discovery);
            missing.run();
        }, DISCOVERY_TIMEOUT_MS);
    }

    private static boolean wirelessDebuggingOn(Context context) {
        try {
            return Settings.Global.getInt(context.getContentResolver(), "adb_wifi_enabled", 0) == 1;
        } catch (SecurityException ignored) {
            return true;
        }
    }

    private static boolean isLocal(InetAddress address) {
        try {
            return address != null && (address.isLoopbackAddress() || NetworkInterface.getByInetAddress(address) != null);
        } catch (SocketException exception) {
            return false;
        }
    }
}
