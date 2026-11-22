package com.scoresaber.encore;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.capawesome.capacitorjs.plugins.nodejs.Nodejs;
import io.capawesome.capacitorjs.plugins.nodejs.NodejsConfig;
import io.capawesome.capacitorjs.plugins.nodejs.NodejsPlugin;
import io.capawesome.capacitorjs.plugins.nodejs.classes.events.MessageEvent;
import io.capawesome.capacitorjs.plugins.nodejs.classes.options.SendOptions;
import io.capawesome.capacitorjs.plugins.nodejs.classes.options.StartOptions;
import io.capawesome.capacitorjs.plugins.nodejs.interfaces.EmptyCallback;
import java.lang.ref.WeakReference;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "Nodejs")
public class EncoreNodejsPlugin extends NodejsPlugin {
    private static Nodejs runtime;
    private static Context appContext;
    private static WeakReference<EncoreNodejsPlugin> active = new WeakReference<>(null);

    @Override
    public void load() {
        synchronized (EncoreNodejsPlugin.class) {
            active = new WeakReference<>(this);
            appContext = getContext().getApplicationContext();
            if (runtime == null) {
                NodejsConfig config = new NodejsConfig();
                config.setNodeDir(getConfig().getString("nodeDir", "nodejs"));
                config.setStartMode(START_MODE_MANUAL);
                runtime = new Nodejs(this, getContext().getApplicationContext(), config);
            }
        }
    }

    @Override
    @PluginMethod
    public void isReady(PluginCall call) {
        call.resolve(new JSObject().put("ready", runtime.isReady()));
    }

    @Override
    @PluginMethod
    public void start(PluginCall call) {
        if (runtime.isReady()) {
            call.resolve();
            return;
        }
        runtime.start(new StartOptions(call), new EmptyCallback() {
            @Override
            public void success() { call.resolve(); }

            @Override
            public void error(Exception exception) { call.reject(exception.getMessage(), "mobile.node-start", exception); }
        });
    }

    @Override
    @PluginMethod
    public void send(PluginCall call) {
        try {
            runtime.send(new SendOptions(call));
            call.resolve();
        } catch (Exception exception) {
            call.reject(exception.getMessage(), "mobile.node-send", exception);
        }
    }

    @Override
    public void notifyMessageListeners(MessageEvent event) {
        JSObject message = event.toJSObject();
        JSONArray args = message.optJSONArray("args");
        JSONObject request = "encore:native".equals(message.getString("eventName")) && args != null ? args.optJSONObject(0) : null;
        if (request != null && "findWirelessDebuggingPort".equals(request.optString("method"))) {
            String id = request.optString("id");
            WirelessDebugging.findPort(
                appContext,
                WirelessDebugging.CONNECT_SERVICE,
                port -> reply(id, new JSObject().put("value", new JSObject().put("port", port))),
                () -> reply(id, failure("mobile.wireless-debugging"))
            );
            return;
        }
        EncoreNodejsPlugin current = active.get();
        if (request != null && "openWirelessDebuggingSettings".equals(request.optString("method"))) {
            String id = request.optString("id");
            var activity = current == null ? null : current.getActivity();
            if (activity == null) {
                reply(id, failure("mobile.native-unavailable"));
                return;
            }
            activity.runOnUiThread(() -> {
                try {
                    reply(id, new JSObject().put("value", WirelessDebugging.openSettings(activity)));
                } catch (RuntimeException exception) {
                    reply(id, failure("mobile.wireless-settings"));
                }
            });
            return;
        }
        if (request != null && "pairWirelessDebugging".equals(request.optString("method"))) {
            String id = request.optString("id");
            JSONObject input = request.optJSONObject("args");
            String code = input == null ? "" : input.optString("code");
            if (!code.matches("[0-9]{6}")) {
                reply(id, failure("mobile.wireless-pairing"));
                return;
            }
            WirelessDebugging.findPort(
                appContext,
                WirelessDebugging.PAIRING_SERVICE,
                port -> new Thread(() -> {
                    try {
                        boolean paired = WirelessDebugging.pair(port, code, input.optString("key"), input.optString("certificate"));
                        reply(id, paired ? new JSObject() : failure("mobile.wireless-pairing"));
                    } catch (Exception exception) {
                        reply(id, failure("mobile.wireless-pairing"));
                    }
                }).start(),
                () -> reply(id, failure("mobile.wireless-pairing-window"))
            );
            return;
        }
        if (current != null) current.notifyListeners(EVENT_MESSAGE, message, true);
        else if (request != null) reply(request.optString("id"), failure("mobile.native-unavailable"));
    }

    private static JSObject failure(String code) {
        return new JSObject().put("error", new JSObject().put("code", code));
    }

    private static void reply(String id, JSObject response) {
        JSObject data = new JSObject();
        data.put("eventName", "encore:native-response");
        data.put("args", new JSArray().put(response.put("id", id)));
        try {
            runtime.send(new SendOptions(new PluginCall(null, "Nodejs", PluginCall.CALLBACK_ID_DANGLING, "send", data)));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void notifyReadyListeners() {
        EncoreNodejsPlugin current = active.get();
        if (current != null) current.notifyListeners(EVENT_READY, new JSObject(), true);
    }

    @Override
    protected void handleOnPause() { runtime.handleOnPause(); }

    @Override
    protected void handleOnResume() { runtime.handleOnResume(); }

    @Override
    protected void handleOnDestroy() {
        if (active.get() == this) active.clear();
        setBridge(null);
    }
}
