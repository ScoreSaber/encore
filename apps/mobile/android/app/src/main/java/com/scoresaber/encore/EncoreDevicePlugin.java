package com.scoresaber.encore;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "EncoreDevice",
    permissions = @Permission(alias = "headsetCamera", strings = "horizonos.permission.HEADSET_CAMERA")
)
public class EncoreDevicePlugin extends Plugin {
    private static final String KEY_ALIAS = "encore.master-wrap";
    private static final long MAX_IMPORT_BYTES = 128L * 1024 * 1024;

    @PluginMethod
    public void getSecretKey(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("key", Base64.encodeToString(readMasterKey(), Base64.NO_WRAP));
            result.put("backend", "android_keystore");
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Encore could not open Android secure storage", "mobile.secure-storage", exception);
        }
    }

    private synchronized byte[] readMasterKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            generator.generateKey();
        }
        SecretKey wrappingKey = (SecretKey) store.getKey(KEY_ALIAS, null);
        SharedPreferences preferences = getContext().getSharedPreferences("encore-secure", Context.MODE_PRIVATE);
        String encoded = preferences.getString("master", null);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (encoded != null) {
            byte[] wrapped = Base64.decode(encoded, Base64.NO_WRAP);
            if (wrapped.length < 28) throw new IllegalStateException("Invalid protected master key");
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey, new GCMParameterSpec(128, wrapped, 0, 12));
            byte[] key = cipher.doFinal(wrapped, 12, wrapped.length - 12);
            if (key.length != 32) throw new IllegalStateException("Invalid master key length");
            return key;
        }
        byte[] master = new byte[32];
        new SecureRandom().nextBytes(master);
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
        byte[] encrypted = cipher.doFinal(master);
        byte[] wrapped = ByteBuffer.allocate(cipher.getIV().length + encrypted.length).put(cipher.getIV()).put(encrypted).array();
        if (!preferences.edit().putString("master", Base64.encodeToString(wrapped, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("Could not save protected master key");
        }
        return master;
    }

    @PluginMethod
    public void scanPairingQr(PluginCall call) {
        if (getPermissionState("headsetCamera") == PermissionState.GRANTED) {
            headsetCameraPermission(call);
        } else {
            requestPermissionForAlias("headsetCamera", call, "headsetCameraPermission");
        }
    }

    @PermissionCallback
    private void headsetCameraPermission(PluginCall call) {
        if (getPermissionState("headsetCamera") != PermissionState.GRANTED) {
            call.reject("Headset camera permission was denied", "camera-permission");
            return;
        }
        Intent intent = new Intent(getContext(), PairingQrActivity.class)
            .putExtra(PairingQrActivity.HINT, call.getString("hint"))
            .putExtra(PairingQrActivity.CANCEL, call.getString("cancel"));
        startActivityForResult(call, intent, "pairingQrScanned");
    }

    @ActivityCallback
    private void pairingQrScanned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_FIRST_USER) {
            call.reject("Could not open the headset camera", "camera-unavailable");
            return;
        }
        Intent data = result.getData();
        String text = result.getResultCode() == Activity.RESULT_OK && data != null ? data.getStringExtra(PairingQrActivity.TEXT) : null;
        call.resolve(new JSObject().put("text", text == null ? JSONObject.NULL : text));
    }

    @PluginMethod
    public void chooseFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "fileChosen");
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("status", "cancelled"));
            return;
        }
        Uri uri = result.getData().getData();
        getBridge().execute(() -> {
            File temporary = null;
            try {
                String fileName = "import.zip";
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) fileName = new File(cursor.getString(0)).getName();
                }
                JSArray requested = call.getArray("extensions");
                List<String> extensions = requested == null ? List.of() : requested.toList();
                String selectedName = fileName.toLowerCase(java.util.Locale.ROOT);
                if (!extensions.isEmpty() && extensions.stream().noneMatch(extension -> selectedName.endsWith("." + extension))) {
                    throw new ImportRejected("Choose a supported file", "mobile.file-unsupported");
                }
                File directory = new File(getContext().getCacheDir(), "encore-imports");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Could not create import directory");
                String suffix = fileName.contains(".") ? fileName.substring(fileName.lastIndexOf('.')) : ".bin";
                temporary = File.createTempFile("encore-", suffix, directory);
                try (InputStream input = getContext().getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(temporary)) {
                    if (input == null) throw new IllegalStateException("Could not read selected file");
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_IMPORT_BYTES) throw new ImportRejected("Choose a file smaller than 128 MiB", "mobile.file-too-large");
                        output.write(buffer, 0, count);
                    }
                }
                JSObject selected = new JSObject();
                selected.put("status", "selected");
                selected.put("path", temporary.getAbsolutePath());
                selected.put("fileName", fileName);
                call.resolve(selected);
            } catch (Exception exception) {
                if (temporary != null) temporary.delete();
                call.reject(exception.getMessage(), exception instanceof ImportRejected rejected ? rejected.code : "mobile.file-picker", exception);
            }
        });
    }

    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("Text is required");
            return;
        }
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Encore", text));
        call.resolve();
    }

    @PluginMethod
    public void openLink(PluginCall call) {
        String address = call.getString("url");
        Uri uri = address == null ? null : Uri.parse(address);
        String scheme = uri == null ? null : uri.getScheme();
        if (scheme == null || !List.of("http", "https", "mailto", "steam", "beatsaver", "modelsaber", "scoresaber").contains(scheme.toLowerCase(java.util.Locale.ROOT))) {
            call.resolve(new JSObject().put("status", "blocked"));
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
            call.resolve(new JSObject().put("status", "opened"));
        } catch (Exception exception) {
            call.reject("No app can open this link", "mobile.open-link", exception);
        }
    }

    @PluginMethod
    public void setDaemonEnabled(PluginCall call) {
        Intent service = new Intent(getContext(), EncoreDaemonService.class);
        try {
            if (Boolean.TRUE.equals(call.getBoolean("enabled", false))) {
                ContextCompat.startForegroundService(getContext(), service);
            } else {
                getContext().stopService(service);
            }
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Encore could not keep the receiver running in the background", "mobile.native-failed", exception);
        }
    }

    private static final class ImportRejected extends Exception {
        final String code;

        ImportRejected(String message, String code) {
            super(message);
            this.code = code;
        }
    }
}
