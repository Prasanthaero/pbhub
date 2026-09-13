/**
 * Make the window give way to the keyboard again.
 *
 * `android:windowSoftInputMode="adjustResize"` used to be the whole answer: the
 * keyboard appears, the app's window shrinks by that much, and the message box
 * — anchored to the bottom — rises with it.
 *
 * Android 15 began forcing apps to draw edge to edge, and Android 16 removed the
 * opt-out. On those versions the window no longer resizes: `dumpsys window`
 * reports the activity as EDGE_TO_EDGE_ENFORCED, the frame stays the full height
 * of the screen, and the keyboard simply slides over the bottom of the app. The
 * message box ends up underneath it — you type into something you cannot see.
 *
 * React Native's own keyboard events are no help there. On a phone in this state
 * `keyboardDidShow` reports the navigation bar rather than the keyboard, with a
 * negative height:
 *
 *     {"screenY":899.4,"height":-24}      // 24dp is the nav bar, and it is not -24
 *
 * So do what the system used to do, in the one place that can still see the real
 * measurement: pad the activity's content view by the keyboard inset. React
 * Native's root view shrinks with it, the layout reflows, and everything
 * anchored to the bottom sits just above the keys — no different from how it
 * behaved before Android changed its mind.
 *
 * The same listener keeps the composer clear of the navigation bar when there is
 * no keyboard, which edge-to-edge had also quietly taken away.
 *
 * A config plugin, not an edit to MainActivity.kt, because `expo prebuild`
 * regenerates that file.
 */
const { withMainActivity } = require('@expo/config-plugins');

const MARK = 'pbhub keyboard insets';

const BLOCK = `
    // --- ${MARK} (injected by plugins/withKeyboardInsets.js) ---
    // Fully qualified so this survives any change to the generated imports.
    val pbhubContent = findViewById<android.view.View>(android.R.id.content)
    val pbhubVisible = android.graphics.Rect()
    var pbhubBars = 0

    // The navigation bar, which edge-to-edge also draws underneath.
    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(pbhubContent) { _, insets ->
      pbhubBars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()).bottom
      insets
    }

    // The keyboard. Measured from the visible frame rather than read from
    // WindowInsets.Type.ime(), because an enforced edge-to-edge window is not
    // sent that inset at all — the listener above never fires again when the
    // keyboard opens. What the window can still see is how much of the screen is
    // covered, which is the same number by a longer road, and has been reliable
    // since long before any of this changed.
    pbhubContent.viewTreeObserver.addOnGlobalLayoutListener {
      pbhubContent.getWindowVisibleDisplayFrame(pbhubVisible)
      val covered = pbhubContent.rootView.height - pbhubVisible.bottom
      val root = androidx.core.view.ViewCompat.getRootWindowInsets(pbhubContent)
      val ime = root?.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())?.bottom ?: 0
      val want = maxOf(ime, covered, pbhubBars)
      // Guarded: setPadding triggers another layout pass, and this listener runs
      // on every one of them.
      if (pbhubContent.paddingBottom != want) {
        pbhubContent.setPadding(0, 0, 0, want)
      }
    }
`;

module.exports = function withKeyboardInsets(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;

    const anchor = 'super.onCreate(null)';
    if (!src.includes(anchor)) {
      throw new Error('withKeyboardInsets: could not find super.onCreate in MainActivity');
    }
    src = src.replace(anchor, `${anchor}\n${BLOCK}`);

    cfg.modResults.contents = src;
    return cfg;
  });
};
