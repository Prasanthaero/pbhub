/**
 * Keeping the message box above the keyboard, on iOS.
 *
 * An iOS window never changes size when the keyboard appears — the keyboard is
 * simply drawn over the bottom of it — so anything anchored to the bottom has to
 * be lifted by hand. That is what this does: report how far.
 *
 * Android is handled underneath instead, in plugins/withKeyboardInsets.js, where
 * the activity pads its own content view by the keyboard inset and every layout
 * above it reflows on its own. It has to be done there: React Native's Android
 * keyboard events are unusable on a modern edge-to-edge window, where
 * `keyboardDidShow` reports the navigation bar rather than the keyboard, with a
 * negative height. So this hook stays out of the way on Android and returns
 * nothing.
 *
 * The measurement is a subtraction rather than the raw keyboard height, so that
 * if a platform ever does resize the window again, the lift quietly becomes
 * zero instead of pushing the box up twice as far.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type LayoutChangeEvent } from 'react-native';

export function useKeyboardInset() {
  const [keyboard, setKeyboard] = useState(0);
  const [windowGave, setWindowGave] = useState(0);

  /** The height of the area with no keyboard over it. The screen does not
   *  change size — the app is portrait only — so the tallest we have ever seen
   *  is the honest full height, whichever order the events arrive in. */
  const full = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // iOS announces the keyboard before it moves, which lets the lift animate
    // alongside it rather than snapping into place afterwards.
    const rising = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const falling = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboard(0);
      setWindowGave(0);
    });
    return () => {
      rising.remove();
      falling.remove();
    };
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > full.current) full.current = h;
    setWindowGave(Math.max(0, full.current - h));
  };

  return { inset: Math.max(0, keyboard - windowGave), onLayout };
}
