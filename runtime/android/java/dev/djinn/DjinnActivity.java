package dev.djinn;

import android.app.NativeActivity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;

/**
 * The activity of a Djinn app: a NativeActivity plus the two things only the Java side can give a native app. A view that is
 * a text editor, so the soft keyboard really opens and its text (typed, swiped, committed by suggestions) reaches the app,
 * and the window insets (system bars, display cutout, keyboard) as the system reports them. The app itself stays native: both
 * go to the runtime shim (runtime/android/android_host.c) through the static native methods below.
 */
public class DjinnActivity extends NativeActivity {
    static native void nativeText(String text);

    static native void nativeKey(int code, int meta);

    static native void nativeInsets(int left, int top, int right, int bottom);

    private InputView input;

    @Override
    protected void onCreate(Bundle state) {
        // NativeActivity opens the library with dlopen, which the Java VM does not know: load it the Java way as well so the
        // native methods below resolve (the second load returns the same library)
        try {
            ActivityInfo info = getPackageManager().getActivityInfo(getComponentName(), PackageManager.GET_META_DATA);
            String name = info.metaData == null ? null : info.metaData.getString("android.app.lib_name");
            if (name != null) {
                System.loadLibrary(name);
            }
        } catch (PackageManager.NameNotFoundException | UnsatisfiedLinkError error) {
            throw new RuntimeException(error);
        }
        super.onCreate(state);
        // the app lays the page out itself around the keyboard (it knows the insets): no panning or resizing by the system
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        // dark icons on the light page (the area behind the bars is the window background, white in light mode)
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if (!night) {
            View decorView = getWindow().getDecorView();
            if (Build.VERSION.SDK_INT >= 30) {
                getWindow().getInsetsController().setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            } else {
                decorView.setSystemUiVisibility(decorView.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        }
        input = new InputView(this);
        addContentView(input, new ViewGroup.LayoutParams(1, 1));
        final View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                report(insets);
                return view.onApplyWindowInsets(insets);
            }
        });
        decor.requestApplyInsets();
    }

    private static void report(WindowInsets insets) {
        int left;
        int top;
        int right;
        int bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            left = bars.left;
            top = bars.top;
            right = bars.right;
            bottom = Math.max(bars.bottom, ime.bottom);
        } else {
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
        }
        nativeInsets(left, top, right, bottom);
    }

    /** Called from the native side. */
    public void showKeyboard() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                input.requestFocus();
                InputMethodManager manager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                manager.restartInput(input);
                manager.showSoftInput(input, 0);
            }
        });
    }

    /** Called from the native side. */
    public void hideKeyboard() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                InputMethodManager manager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                manager.hideSoftInputFromWindow(input.getWindowToken(), 0);
            }
        });
    }

    /** An invisible view that accepts text: what the keyboard types arrives as characters and key presses. */
    private static final class InputView extends View {
        InputView(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(true);
        }

        @Override
        public boolean onCheckIsTextEditor() {
            return true;
        }

        @Override
        public InputConnection onCreateInputConnection(EditorInfo info) {
            // no suggestions and no composing regions of the keyboard: what it types is committed text, so the field
            // is always what the user sees
            info.inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD;
            info.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN | EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_ACTION_NONE;
            return new Connection(this);
        }
    }

    private static final class Connection extends BaseInputConnection {
        // the text of the current composition, kept in the app's field while the keyboard may still change it
        private String composing = "";

        Connection(View view) {
            super(view, false);
        }

        private void dropComposing() {
            for (int i = 0; i < composing.length(); i = composing.offsetByCodePoints(i, 1)) {
                nativeKey(KeyEvent.KEYCODE_DEL, 0);
            }
            composing = "";
        }

        @Override
        public boolean commitText(CharSequence text, int newCursorPosition) {
            dropComposing();
            if (text.length() > 0) {
                nativeText(text.toString());
            }
            return true;
        }

        @Override
        public boolean setComposingText(CharSequence text, int newCursorPosition) {
            dropComposing();
            composing = text.toString();
            if (composing.length() > 0) {
                nativeText(composing);
            }
            return true;
        }

        @Override
        public boolean finishComposingText() {
            composing = "";
            return true;
        }

        @Override
        public boolean deleteSurroundingText(int before, int after) {
            dropComposing();
            for (int i = 0; i < before; i++) {
                nativeKey(KeyEvent.KEYCODE_DEL, 0);
            }
            for (int i = 0; i < after; i++) {
                nativeKey(KeyEvent.KEYCODE_FORWARD_DEL, 0);
            }
            return true;
        }

        @Override
        public boolean sendKeyEvent(KeyEvent event) {
            if (event.getAction() != KeyEvent.ACTION_DOWN) {
                return true;
            }
            int character = event.getUnicodeChar();
            if (character != 0 && (event.getMetaState() & KeyEvent.META_CTRL_ON) == 0) {
                dropComposing();
                nativeText(new String(Character.toChars(character)));
            } else {
                nativeKey(event.getKeyCode(), event.getMetaState());
            }
            return true;
        }

        @Override
        public boolean performEditorAction(int action) {
            nativeKey(KeyEvent.KEYCODE_ENTER, 0);
            return true;
        }
    }
}
