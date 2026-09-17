/**
 * A dot in the status bar, and nothing else.
 *
 * An ordinary chat notification is a banner across the top of the phone with a
 * name and a line of the message in it. That is exactly what this app must not
 * do: the whole point is that a glance at the screen gives nothing away, and a
 * preview undoes that more thoroughly than anything else in the codebase.
 *
 * So the notification here carries no sender, no preview and no sound, and is
 * posted at low importance — which on Android means a small icon in the status
 * bar and no heads-up popup. The icon is a plain dot. It says "something
 * arrived"; you open the app to find out what, which you had to do anyway.
 *
 * What this cannot do
 * -------------------
 * It only fires while the app is still alive in the background. There is no
 * push service and no foreground service, so once Android suspends or kills the
 * app — minutes to hours, at its discretion — nothing arrives to notify about.
 * Making it reliable would mean either Google's push servers holding a device
 * token that identifies the phone, or a permanent notification saying the app
 * is running. Both cost more than they are worth here, and the setting says so.
 */
import { Platform } from 'react-native';

/**
 * Loaded through a guard, because it does not survive Expo Go.
 *
 * Expo Go dropped push notifications in SDK 53, and expo-notifications throws
 * while it is still loading there — not when something is posted, but on
 * import, which takes the whole app down before it draws. Nothing here needs
 * push: this is a local notification, the kind Expo Go still supports. It is
 * the library's own startup check that objects.
 *
 * Where it cannot load, every function below quietly does nothing. That costs
 * the dot in the status bar while testing in Expo Go, and costs the real app
 * nothing at all.
 */
type NotificationsModule = typeof import('expo-notifications');

let Notifications: NotificationsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Notifications = require('expo-notifications') as NotificationsModule;
} catch {
  Notifications = null;
}

const CHANNEL = 'quiet';

let ready = false;

/**
 * Set up the channel once.
 *
 * Importance LOW is the entire trick: it shows in the status bar and the shade,
 * but never as a banner and never with a sound. MIN would hide it from the
 * status bar too, which defeats the point.
 */
export async function prepareNotifications(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.granted
      ? true
      : (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Notes',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        // No badge count either: a number beside the icon is a message count,
        // which is more than the dot is meant to say.
        showBadge: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
      });
    }

    ready = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Post the dot.
 *
 * Deliberately identical every time and tagged with a fixed identifier, so ten
 * messages produce one dot rather than a stack that betrays how much was said.
 */
export async function showDot(): Promise<void> {
  console.log('[dot] ready?', ready, !!Notifications);
  if (!ready || !Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: 'dot',
      content: {
        // Android insists on some text in the shade. This is the app's own
        // name and nothing more — no sender, no preview, no count.
        title: 'Notes',
        body: '',
        // false, not null: silence is a value here, and the channel's LOW
        // importance already rules out sound and vibration on Android.
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
      trigger: null,
    });
  } catch {
    // A notification that fails to post is not worth interrupting anything for.
  }
}

/** Clear it — called when the chat is opened, since the dot has done its job. */
export async function clearDot(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.dismissNotificationAsync('dot');
  } catch {}
}
