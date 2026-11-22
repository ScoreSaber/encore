package com.scoresaber.encore;

import android.content.Intent;
import android.graphics.Color;
import android.hardware.camera2.CameraCharacteristics;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.Size;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

public class PairingQrActivity extends AppCompatActivity {
    static final String TEXT = "text";
    static final String HINT = "hint";
    static final String CANCEL = "cancel";
    private static final CameraCharacteristics.Key<Integer> CAMERA_SOURCE =
        new CameraCharacteristics.Key<>("com.meta.extra_metadata.camera_source", int.class);
    private static final int PASSTHROUGH = 0;

    private final ExecutorService analyzer = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanned = new AtomicBoolean();
    private final QRCodeReader reader = new QRCodeReader();
    private long nextScanTime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PreviewView preview = new PreviewView(this);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        showScanner(preview);

        var cameraProvider = ProcessCameraProvider.getInstance(this);
        cameraProvider.addListener(() -> {
            if (isDestroyed() || isFinishing()) return;
            try {
                bindCamera(cameraProvider.get(), preview);
            } catch (Exception exception) {
                Log.w("EncorePairingQr", "Could not start the headset scanner", exception);
                cameraFailed();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void showScanner(PreviewView preview) {
        int padding = Math.round(12 * getResources().getDisplayMetrics().density);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setBackgroundColor(Color.BLACK);
        layout.setPadding(padding, padding, padding, padding);
        layout.addView(preview, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        TextView hint = new TextView(this);
        hint.setText(getIntent().getStringExtra(HINT));
        hint.setTextColor(Color.WHITE);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, padding, 0, 0);
        layout.addView(hint);

        Button cancel = new Button(this);
        cancel.setText(getIntent().getStringExtra(CANCEL));
        cancel.setOnClickListener(view -> finish());
        layout.addView(cancel);
        setContentView(layout);
    }

    @ExperimentalCamera2Interop
    private void bindCamera(ProcessCameraProvider provider, PreviewView view) {
        CameraSelector camera = new CameraSelector.Builder()
            .addCameraFilter(cameras -> cameras.stream()
                .filter(info -> Integer.valueOf(PASSTHROUGH).equals(Camera2CameraInfo.from(info).getCameraCharacteristic(CAMERA_SOURCE)))
                .collect(Collectors.toCollection(ArrayList::new)))
            .build();
        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(view.getSurfaceProvider());

        ResolutionSelector resolution = new ResolutionSelector.Builder()
            .setResolutionStrategy(new ResolutionStrategy(new Size(1280, 960), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build();
        ImageAnalysis images = new ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        images.setAnalyzer(analyzer, this::scan);
        provider.bindToLifecycle(this, camera, preview, images).getCameraInfo().getCameraState().observe(this, state -> {
            var error = state.getError();
            if (error == null) return;
            Log.w("EncorePairingQr", "Headset camera error " + error.getCode(), error.getCause());
            cameraFailed();
        });
    }

    private void cameraFailed() {
        if (isFinishing()) return;
        setResult(RESULT_FIRST_USER);
        finish();
    }

    private void scan(ImageProxy image) {
        try (image) {
            long now = SystemClock.elapsedRealtime();
            if (scanned.get() || now < nextScanTime) return;
            nextScanTime = now + 150;
            var plane = image.getPlanes()[0];
            var buffer = plane.getBuffer();
            byte[] luminance = new byte[buffer.remaining()];
            buffer.get(luminance);
            int width = image.getWidth();
            int height = image.getHeight();
            var source = new PlanarYUVLuminanceSource(luminance, plane.getRowStride(), height, 0, 0, width, height, false);
            String text = reader.decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
            if (!scanned.compareAndSet(false, true)) return;
            runOnUiThread(() -> {
                if (isFinishing()) return;
                setResult(RESULT_OK, new Intent().putExtra(TEXT, text));
                finish();
            });
        } catch (ReaderException ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        analyzer.shutdown();
    }
}
