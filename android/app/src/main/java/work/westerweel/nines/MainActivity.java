package work.westerweel.nines;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * The game in Capacitor's WebView. The back button does what the game's own back does
 * (src/game/back.ts): it closes the terminal, a battle, a screen, the menu or a dialogue. With
 * nothing open, the app goes to the background like any Android app's first screen; the game
 * saves on the way (visibilitychange in src/main.ts).
 */
public class MainActivity extends BridgeActivity {

    /** true when the page closed something; anything else (no game yet, an error) is false */
    private static final String BACK = "typeof window.ninesBack === 'function' && window.ninesBack() === true";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge == null ? null : bridge.getWebView();
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript(BACK, handled -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                });
            }
        });
    }
}
