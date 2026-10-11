package dev.ahristov.redline;

import android.Manifest;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayDeque;

/**
 * Phone sensors for recording: running cadence and steps from the step
 * detector, and relative altitude from the barometer. Updates are sent to the
 * web layer as "motion" events, matching the iOS plugin.
 */
@CapacitorPlugin(
    name = "Motion",
    permissions = { @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class MotionPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensors;
    private final ArrayDeque<Long> stepTimes = new ArrayDeque<>();
    private int steps = 0;
    private Float basePressure = null;
    private long lastPressureEvent = 0;
    private boolean running = false;

    private SensorManager sm() {
        if (sensors == null) sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        return sensors;
    }

    private boolean needsActivityPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("activity") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        boolean step = sm().getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) != null;
        r.put("steps", step);
        r.put("cadence", step);
        r.put("barometer", sm().getDefaultSensor(Sensor.TYPE_PRESSURE) != null);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (needsActivityPermission()) {
            requestPermissionForAlias("activity", call, "activityPermissionResult");
            return;
        }
        begin();
        call.resolve();
    }

    @PermissionCallback
    private void activityPermissionResult(PluginCall call) {
        // Without the permission the barometer still works, so start anyway.
        begin();
        call.resolve();
    }

    private void begin() {
        if (running) return;
        running = true;
        steps = 0;
        stepTimes.clear();
        basePressure = null;
        Sensor step = sm().getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
        if (step != null && !needsActivityPermission()) sm().registerListener(this, step, SensorManager.SENSOR_DELAY_FASTEST);
        Sensor pressure = sm().getDefaultSensor(Sensor.TYPE_PRESSURE);
        if (pressure != null) sm().registerListener(this, pressure, SensorManager.SENSOR_DELAY_NORMAL);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        sm().unregisterListener(this);
        running = false;
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long now = System.currentTimeMillis();
        int type = e.sensor.getType();
        if (type == Sensor.TYPE_STEP_DETECTOR) {
            steps++;
            stepTimes.addLast(now);
            while (!stepTimes.isEmpty() && now - stepTimes.peekFirst() > 10000) stepTimes.removeFirst();
            if (steps % 4 == 0 && stepTimes.size() > 4) {
                double span = (stepTimes.peekLast() - stepTimes.peekFirst()) / 1000.0;
                JSObject o = new JSObject();
                o.put("type", "steps");
                o.put("steps", steps);
                if (span > 0) o.put("cadence", (stepTimes.size() - 1) / span * 60.0);
                o.put("t", now);
                notifyListeners("motion", o);
            }
        } else if (type == Sensor.TYPE_PRESSURE) {
            if (now - lastPressureEvent < 1000) return;
            lastPressureEvent = now;
            float hPa = e.values[0];
            if (basePressure == null) basePressure = hPa;
            double rel = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, hPa)
                - SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, basePressure);
            JSObject o = new JSObject();
            o.put("type", "altitude");
            o.put("relativeAltitude", rel);
            o.put("pressure", hPa);
            o.put("t", now);
            notifyListeners("motion", o);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
