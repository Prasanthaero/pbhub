/**
 * Keeping the message box above the keyboard.
 *
 * An iOS window never changes size when the keyboard appears — the keyboard is
 * simply drawn over the bottom of it — so anything anchored to the bottom has to
 * be lifted by hand. That is what this reports: how far.
 *
 * In a real Android build this does nothing, because the activity has already
 * padded itself by the keyboard inset (plugins/withKeyboardInsets.js) and every
 * layout above it has reflowed. That work has to happen down there: React
 * Native's Android keyboard events are unreliable on a modern edge-to-edge
 * window, where `keyboardDidShow` has been seen reporting the navigation bar
 * instead of the keyboard, as a negative height.
 *
 * Inside Expo Go there is no such activity to lean on — it is Expo Go's, and our
 * plugin is not in it — so the hook takes the job on there and makes what it can
 * of React Native's numbers, ignoring any that are not a plausible keyboard.
 *
 * The measurement is a subtraction rather than the raw keyboard height, so where
 * something else has already made room, the lift quietly becomes zero instead of
 * pushing the box up twice as far.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type LayoutChangeEvent } from 'react-native';
import { inExpoGo } from '../env';

export function useKeyboardInset() {
  const [keyboard, setKeyboard] = useState(0);
  const [windowGave, setWindowGave] = useState(0);

  /** The height of the area with no keyboard over it. The screen does not
   *  change size — the app is portrait only — so the tallest we have ever seen
   *  is the honest full height, whichever order the events arrive in. */
  const full = useRef(0);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    // Android normally needs nothing here — the activity pads itself. Inside
    // Expo Go the activity is Expo Go's, so there is nobody else to do it.
    if (!ios && !inExpoGo) return;

    // iOS announces the keyboard before it moves, which lets the lift animate
    // alongside it rather than snapping into place afterwards.
    const rising = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      // Android has been seen reporting the navigation bar instead of the
      // keyboard, as a negative number. Anything at or below zero is not a
      // keyboard, so treat it as no keyboard rather than as a measurement.
      const h = e.endCoordinates?.height ?? 0;
      setKeyboard(h > 0 ? h : 0);
    });
    const falling = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
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
