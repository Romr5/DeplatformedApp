package com.anonymous.DeplatformedApp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;

public class NearbyModule extends ReactContextBaseJavaModule {
    private static final String TAG = "NearbyModule";
    private static final String SERVICE_ID = "com.anonymous.deplatformed.mesh";
    private static final String SOS_CHANNEL_ID = "deplatformed_emergency_sos";
    private final ReactApplicationContext reactContext;
    private final ConcurrentHashMap<String, String> endpointNames = new ConcurrentHashMap<>();
    private boolean isDiscovering = false;
    private final Handler discoveryCycleHandler = new Handler(Looper.getMainLooper());

    private void pauseDiscoveryTemporarily() {
        discoveryCycleHandler.removeCallbacksAndMessages(null);
        try {
            Nearby.getConnectionsClient(reactContext).stopDiscovery();
        } catch (Exception ignored) {}
        // Safety watchdog: automatically resume discovery duty cycling after 5 seconds
        // so discovery is never permanently wedged if connection negotiation stalls or drops
        discoveryCycleHandler.postDelayed(() -> {
            if (isDiscovering) {
                scheduleNextDiscoveryCycle();
            }
        }, 5000);
    }

    private void scheduleNextDiscoveryCycle() {
        if (!isDiscovering) return;
        discoveryCycleHandler.removeCallbacksAndMessages(null);
        // Scan window: 2.5s - 3.8s
        long scanDuration = 2500 + (long)(Math.random() * 1300);
        discoveryCycleHandler.postDelayed(discoveryCycleRunnable, scanDuration);
    }

    private final Runnable discoveryCycleRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isDiscovering) return;
            try {
                // Pause discovery scan to yield antenna time slices to BLE advertising (TX)
                Nearby.getConnectionsClient(reactContext).stopDiscovery();

                // Allow transmitter 2.0s - 3.0s of clean, uninterrupted antenna airtime
                long pauseDuration = 2000 + (long)(Math.random() * 1000);
                discoveryCycleHandler.postDelayed(() -> {
                    if (!isDiscovering) return;
                    try {
                        DiscoveryOptions discOptions = new DiscoveryOptions.Builder()
                            .setStrategy(Strategy.P2P_CLUSTER)
                            .setLowPower(true)
                            .build();
                        Nearby.getConnectionsClient(reactContext)
                            .startDiscovery(SERVICE_ID, endpointDiscoveryCallback, discOptions);
                    } catch (Exception ignored) {}
                    scheduleNextDiscoveryCycle();
                }, pauseDuration);
            } catch (Exception ignored) {}
        }
    };

    public static final String PREF_BG_RELAY = "pref_bg_relay_enabled";

    public static boolean isBackgroundRelayConfigured(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("deplatformed_prefs", Context.MODE_PRIVATE);
            return prefs.getBoolean(PREF_BG_RELAY, true);
        } catch (Exception e) {
            return true;
        }
    }

    public NearbyModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.isBackgroundRelayEnabled = isBackgroundRelayConfigured(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "NearbyModule";
    }

    private String getSystemProperty(String propName) {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            java.lang.reflect.Method get = c.getMethod("get", String.class, String.class);
            String val = (String) get.invoke(null, propName, "");
            if (val != null && !val.isEmpty()) return val.trim();
        } catch (Exception ignored) {}

        java.io.BufferedReader input = null;
        try {
            Process p = Runtime.getRuntime().exec("getprop " + propName);
            input = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()), 1024);
            String line = input.readLine();
            return line != null ? line.trim() : "";
        } catch (Exception ignored) {
            return "";
        } finally {
            if (input != null) {
                try { input.close(); } catch (Exception ignored) {}
            }
        }
    }

    @ReactMethod
    public void getDeviceHardwareId(Promise promise) {
        String androidId = "";
        try {
            androidId = android.provider.Settings.Secure.getString(
                reactContext.getContentResolver(),
                android.provider.Settings.Secure.ANDROID_ID
            );
        } catch (Exception ignored) {}

        String roSerial = getSystemProperty("ro.serialno");
        String bootSerial = getSystemProperty("ro.boot.serialno");

        String serial = "";
        try {
            serial = Build.SERIAL;
        } catch (Exception ignored) {}

        StringBuilder sb = new StringBuilder();
        if (androidId != null && !androidId.isEmpty()) sb.append(androidId).append(",");
        if (!roSerial.isEmpty()) sb.append(roSerial).append(",");
        if (!bootSerial.isEmpty()) sb.append(bootSerial).append(",");
        if (serial != null && !serial.isEmpty() && !serial.equalsIgnoreCase("unknown")) sb.append(serial).append(",");
        sb.append(Build.MODEL).append(",");
        sb.append(Build.DEVICE).append(",");
        sb.append(Build.PRODUCT).append(",");
        sb.append(Build.BOARD);

        String combined = sb.toString().trim();
        promise.resolve(combined.isEmpty() ? "unknown" : combined);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                SOS_CHANNEL_ID,
                "Emergency Distress Beacons",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("High priority offline radio SOS beacons");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 800});
            NotificationManager nm = reactContext.getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void showEmergencyNotification(String title, String content) {
        try {
            createNotificationChannel();
            Intent intent = new Intent(reactContext, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                reactContext,
                1001,
                intent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(reactContext, SOS_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(title)
                .setContentText(content)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 500, 200, 500, 200, 800})
                .setContentIntent(pendingIntent);

            NotificationManager nm = (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(911, builder.build());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to show emergency notification", e);
        }
    }

    private static final String CHAT_CHANNEL_ID = "deplatformed_mesh_chat";

    private void createChatNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHAT_CHANNEL_ID,
                "Mesh Messages",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Incoming peer-to-peer mesh messages");
            channel.enableVibration(true);
            NotificationManager nm = reactContext.getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void showChatNotification(String endpointId) {
        try {
            // Only show system notification if the activity is not currently in foreground focus
            if (reactContext.hasCurrentActivity() && reactContext.getCurrentActivity().hasWindowFocus()) {
                return;
            }
            createChatNotificationChannel();
            String peerName = endpointNames.get(endpointId);
            if (peerName == null || peerName.isEmpty()) peerName = "Nearby Peer";

            Intent intent = new Intent(reactContext, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                reactContext,
                1002,
                intent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(reactContext, CHAT_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("💬 " + peerName)
                .setContentText("New encrypted mesh message received")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

            NotificationManager nm = (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify((int) (System.currentTimeMillis() % 100000), builder.build());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to show chat notification", e);
        }
    }

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext.hasActiveCatalystInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
        }
    }

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(@NonNull String endpointId, @NonNull Payload payload) {
            if (payload.getType() == Payload.Type.BYTES) {
                byte[] bytes = payload.asBytes();
                if (bytes != null) {
                    String message = new String(bytes, StandardCharsets.UTF_8);
                    WritableMap params = Arguments.createMap();
                    params.putString("endpointId", endpointId);
                    params.putString("message", message);
                    sendEvent("onMessageReceived", params);

                    // Background notification if payload contains SOS distress beacon
                    if (message.contains("HELP_REQUEST")) {
                        showEmergencyNotification(
                            "🚨 EMERGENCY SOS DISTRESS SIGNAL",
                            "Nearby mesh peer is broadcasting an emergency distress beacon!"
                        );
                    } else if (message.contains("\"type\":\"MSG\"") || message.contains("\"type\":\"ROOM_MSG\"")) {
                        showChatNotification(endpointId);
                    }
                }
            }
        }

        @Override
        public void onPayloadTransferUpdate(@NonNull String endpointId, @NonNull PayloadTransferUpdate update) {}
    };

    private final ConnectionLifecycleCallback connectionLifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(@NonNull String endpointId, @NonNull ConnectionInfo connectionInfo) {
            endpointNames.put(endpointId, connectionInfo.getEndpointName());
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            params.putString("endpointName", connectionInfo.getEndpointName());
            sendEvent("onConnectionInitiated", params);
        }

        @Override
        public void onConnectionResult(@NonNull String endpointId, @NonNull ConnectionResolution result) {
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            boolean success = result.getStatus().isSuccess();
            params.putBoolean("success", success);
            String name = endpointNames.get(endpointId);
            if (name != null) {
                params.putString("endpointName", name);
            }
            if (!success) {
                endpointNames.remove(endpointId);
            }
            scheduleNextDiscoveryCycle();
            sendEvent("onConnectionResult", params);
        }

        @Override
        public void onDisconnected(@NonNull String endpointId) {
            endpointNames.remove(endpointId);
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            sendEvent("onDisconnected", params);
        }
    };

    private final EndpointDiscoveryCallback endpointDiscoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(@NonNull String endpointId, @NonNull DiscoveredEndpointInfo info) {
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            params.putString("endpointName", info.getEndpointName());
            params.putString("deviceAddress", endpointId);
            params.putString("deviceName", info.getEndpointName());
            sendEvent("onPeerDiscovered", params);
        }

        @Override
        public void onEndpointLost(@NonNull String endpointId) {
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            sendEvent("onPeerLost", params);
        }
    };

    private void startMeshForegroundService() {
        try {
            Intent serviceIntent = new Intent(reactContext, NearbyMeshService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(serviceIntent);
            } else {
                reactContext.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start NearbyMeshService", e);
        }
    }

    private void stopMeshForegroundService() {
        try {
            Intent serviceIntent = new Intent(reactContext, NearbyMeshService.class);
            serviceIntent.setAction(NearbyMeshService.ACTION_STOP);
            reactContext.startService(serviceIntent);
            reactContext.stopService(serviceIntent);
            NotificationManager nm = (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NearbyMeshService.NOTIFICATION_ID);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop NearbyMeshService", e);
        }
    }

    private boolean isBackgroundRelayEnabled = true;

    @ReactMethod
    public void setBackgroundRelayEnabled(boolean enabled, Promise promise) {
        this.isBackgroundRelayEnabled = enabled;
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("deplatformed_prefs", Context.MODE_PRIVATE);
            prefs.edit().putBoolean(PREF_BG_RELAY, enabled).apply();
        } catch (Exception e) {
            Log.w(TAG, "Failed to persist background relay pref", e);
        }
        if (enabled) {
            startMeshForegroundService();
        } else {
            stopMeshForegroundService();
        }
        if (promise != null) {
            promise.resolve(enabled);
        }
    }

    @ReactMethod
    public void startAdvertising(String myName, Promise promise) {
        if (isBackgroundRelayEnabled) {
            startMeshForegroundService();
        }
        AdvertisingOptions options = new AdvertisingOptions.Builder()
            .setStrategy(Strategy.P2P_CLUSTER)
            .setLowPower(false)
            .build();

        Nearby.getConnectionsClient(reactContext)
            .startAdvertising(myName, SERVICE_ID, connectionLifecycleCallback, options)
            .addOnSuccessListener(unused -> promise.resolve(true))
            .addOnFailureListener(e -> promise.reject("ADVERTISING_ERROR", e.getMessage()));
    }

    @ReactMethod
    public void startDiscovery(Promise promise) {
        if (isBackgroundRelayEnabled) {
            startMeshForegroundService();
        }
        isDiscovering = true;
        discoveryCycleHandler.removeCallbacksAndMessages(null);

        DiscoveryOptions options = new DiscoveryOptions.Builder()
            .setStrategy(Strategy.P2P_CLUSTER)
            .setLowPower(true)
            .build();

        Nearby.getConnectionsClient(reactContext)
            .startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
            .addOnSuccessListener(unused -> {
                scheduleNextDiscoveryCycle();
                if (promise != null) promise.resolve(true);
            })
            .addOnFailureListener(e -> {
                if (promise != null) promise.reject("DISCOVERY_ERROR", e.getMessage());
            });
    }

    @ReactMethod
    public void stopDiscovery(Promise promise) {
        try {
            isDiscovering = false;
            discoveryCycleHandler.removeCallbacksAndMessages(null);
            Nearby.getConnectionsClient(reactContext).stopDiscovery();
            if (promise != null) promise.resolve(true);
        } catch (Exception e) {
            if (promise != null) promise.reject("STOP_DISCOVERY_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void restartDiscoveryAndAdvertising(String myName, Promise promise) {
        try {
            isDiscovering = false;
            discoveryCycleHandler.removeCallbacksAndMessages(null);
            Nearby.getConnectionsClient(reactContext).stopDiscovery();
            Nearby.getConnectionsClient(reactContext).stopAdvertising();
            Nearby.getConnectionsClient(reactContext).stopAllEndpoints();

            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    AdvertisingOptions advOptions = new AdvertisingOptions.Builder()
                        .setStrategy(Strategy.P2P_CLUSTER)
                        .setLowPower(false)
                        .build();
                    DiscoveryOptions discOptions = new DiscoveryOptions.Builder()
                        .setStrategy(Strategy.P2P_CLUSTER)
                        .setLowPower(true)
                        .build();

                    Nearby.getConnectionsClient(reactContext)
                        .startAdvertising(myName, SERVICE_ID, connectionLifecycleCallback, advOptions);

                    isDiscovering = true;
                    Nearby.getConnectionsClient(reactContext)
                        .startDiscovery(SERVICE_ID, endpointDiscoveryCallback, discOptions)
                        .addOnSuccessListener(unused -> {
                            scheduleNextDiscoveryCycle();
                        });

                    if (promise != null) promise.resolve(true);
                } catch (Exception ex) {
                    if (promise != null) promise.reject("RESTART_ERROR", ex.getMessage());
                }
            }, 400);
        } catch (Exception e) {
            if (promise != null) promise.reject("RESTART_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToPeer(String endpointId, String myName, Promise promise) {
        pauseDiscoveryTemporarily();
        Nearby.getConnectionsClient(reactContext)
            .requestConnection(myName, endpointId, connectionLifecycleCallback)
            .addOnSuccessListener(unused -> {
                if (promise != null) promise.resolve(true);
            })
            .addOnFailureListener(e -> {
                scheduleNextDiscoveryCycle();
                if (promise != null) promise.reject("CONNECT_ERROR", e.getMessage());
            });
    }

    @ReactMethod
    public void acceptConnection(String endpointId, Promise promise) {
        pauseDiscoveryTemporarily();
        Nearby.getConnectionsClient(reactContext)
            .acceptConnection(endpointId, payloadCallback)
            .addOnSuccessListener(unused -> {
                if (promise != null) promise.resolve(true);
            })
            .addOnFailureListener(e -> {
                scheduleNextDiscoveryCycle();
                if (promise != null) promise.reject("ACCEPT_ERROR", e.getMessage());
            });
    }

    @ReactMethod
    public void rejectConnection(String endpointId, Promise promise) {
        Nearby.getConnectionsClient(reactContext)
            .rejectConnection(endpointId)
            .addOnSuccessListener(unused -> promise.resolve(true))
            .addOnFailureListener(e -> promise.reject("REJECT_ERROR", e.getMessage()));
    }

    @ReactMethod
    public void disconnectFromEndpoint(String endpointId, Promise promise) {
        try {
            endpointNames.remove(endpointId);
            Nearby.getConnectionsClient(reactContext).disconnectFromEndpoint(endpointId);
            WritableMap params = Arguments.createMap();
            params.putString("endpointId", endpointId);
            sendEvent("onDisconnected", params);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("DISCONNECT_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getConnectedEndpoints(Promise promise) {
        try {
            com.facebook.react.bridge.WritableArray array = Arguments.createArray();
            for (java.util.Map.Entry<String, String> entry : endpointNames.entrySet()) {
                WritableMap map = Arguments.createMap();
                map.putString("endpointId", entry.getKey());
                map.putString("endpointName", entry.getValue());
                array.pushMap(map);
            }
            promise.resolve(array);
        } catch (Exception e) {
            promise.reject("GET_CONNECTED_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void resyncConnectedEndpoints(Promise promise) {
        try {
            int count = 0;
            for (java.util.Map.Entry<String, String> entry : endpointNames.entrySet()) {
                WritableMap params = Arguments.createMap();
                params.putString("endpointId", entry.getKey());
                params.putBoolean("success", true);
                params.putString("endpointName", entry.getValue());
                sendEvent("onConnectionResult", params);
                count++;
            }
            promise.resolve(count);
        } catch (Exception e) {
            promise.reject("RESYNC_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void sendMessage(String endpointId, String message, Promise promise) {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        Payload payload = Payload.fromBytes(bytes);
        Nearby.getConnectionsClient(reactContext)
            .sendPayload(endpointId, payload)
            .addOnSuccessListener(unused -> promise.resolve(true))
            .addOnFailureListener(e -> promise.reject("SEND_ERROR", e.getMessage()));
    }

    @ReactMethod
    public void stopAllEndpoints(Promise promise) {
        try {
            isDiscovering = false;
            discoveryCycleHandler.removeCallbacksAndMessages(null);
            endpointNames.clear();
            stopMeshForegroundService();
            Nearby.getConnectionsClient(reactContext).stopAdvertising();
            Nearby.getConnectionsClient(reactContext).stopDiscovery();
            Nearby.getConnectionsClient(reactContext).stopAllEndpoints();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (promise != null) promise.resolve(true);
            }, 100);
        } catch (Exception e) {
            if (promise != null) promise.reject("STOP_ERROR", e.getMessage());
        }
    }
}
