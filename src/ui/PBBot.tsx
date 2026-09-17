/**
 * PB — the little one who guards the door.
 *
 * He is drawn, not an image: every part of him is a View, so there is no asset
 * to ship, nothing to decode, and he looks the same on every phone regardless
 * of which emoji font it happens to have. That matters more here than it
 * normally would — an emoji face would render as a different creature on each
 * side of the conversation.
 *
 * He has one job at the door and another one inside. At the door he reacts to
 * a wrong PIN, and after three he shuts it. Inside, he is something to poke at
 * while waiting for a reply.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native';
import { T } from '../theme';

export type PBMood = 'idle' | 'happy' | 'love' | 'sad' | 'locked' | 'sleepy';

type Props = {
  mood?: PBMood;
  /**
   * Bump this to make him react again without the mood changing — two wrong
   * PINs in a row are both 'sad', and the second one still has to land.
   */
  beat?: number;
  /** Width of his head. Everything else is measured from this. */
  size?: number;
  /** A line in a small bubble above him. Empty or missing shows nothing. */
  say?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
};

const SHELL = '#334054';
const SHELL_EDGE = '#4B5C77';
const FACE = '#090D13';
const EYE = '#8CE7FF';
const EYE_LOVE = '#FFA7C2';
const EYE_DIM = '#5E7186';
const BLUSH = '#FF6E8A';
const EAR_IN = '#FF9FB8';
const HEART = '#FF5C86';

/** Sweet nothings, for when he is prodded inside the chat. */
export const PB_LINES = [
  'hi hi',
  'still here',
  'she is thinking about you',
  'say something nice',
  'i kept everything safe',
  'nobody got in',
  'boop',
  'ask about their day',
  'i like it when you two talk',
  'send a photo',
  'i counted the seconds',
  'no strangers today',
];

/**
 * What is in the tray when PB is held down.
 *
 * Tapping one sends it to the other phone. Holding one puts PB in that mood for
 * a while — he is the one wearing the feeling, so the list is short and every
 * entry maps onto a face he actually has.
 */
export const PB_EMOJI: { e: string; mood: PBMood; line: string }[] = [
  { e: '❤️', mood: 'love', line: 'all hearts now' },
  { e: '😘', mood: 'love', line: 'kisses' },
  { e: '😂', mood: 'happy', line: 'ha!' },
  { e: '👍', mood: 'happy', line: 'ok ok' },
  { e: '🔥', mood: 'happy', line: 'on fire' },
  { e: '🥺', mood: 'sad', line: 'aw' },
  { e: '😴', mood: 'sleepy', line: 'sleepy' },
  { e: '🌙', mood: 'sleepy', line: 'good night' },
];

/** A heart made of two circles and a turned square. */
function Heart({ w, color }: { w: number; color: string }) {
  return (
    <View style={{ width: w, height: w }}>
      <View
        style={{
          position: 'absolute', top: 0, left: 0,
          width: w * 0.55, height: w * 0.55, borderRadius: w * 0.275,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute', top: 0, right: 0,
          width: w * 0.55, height: w * 0.55, borderRadius: w * 0.275,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute', top: w * 0.14, left: w * 0.145,
          width: w * 0.71, height: w * 0.71, borderRadius: w * 0.06,
          backgroundColor: color, transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export default function PBBot({
  mood = 'idle', beat = 0, size = 96, say, onPress, onLongPress, style,
}: Props) {
  const float = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const bubble = useRef(new Animated.Value(0)).current;
  const antenna = useRef(new Animated.Value(0)).current;
  /** Four hearts that rise and fade whenever he is happy about something. */
  const rise = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const [tears, setTears] = useState(0);

  const eyesOpen = mood === 'idle' || mood === 'sad';
  const eyeColor = mood === 'love' ? EYE_LOVE : mood === 'locked' ? EYE_DIM : EYE;

  // Breathing. He is never quite still, which is most of what makes him read
  // as alive rather than as a picture of a robot.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(antenna, {
          toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(antenna, {
          toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [antenna]);

  // Blinking, at uneven intervals. A metronome blink looks mechanical.
  useEffect(() => {
    if (!eyesOpen) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const again = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.06, duration: 80, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true }),
        ]).start(again);
      }, 1800 + Math.random() * 3200);
    };
    again();
    return () => { alive = false; clearTimeout(timer); blink.setValue(1); };
  }, [eyesOpen, blink]);

  const burst = () => {
    rise.forEach((v, i) => {
      v.setValue(0);
      Animated.timing(v, {
        toValue: 1, duration: 1100 + i * 120, delay: i * 90,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    });
  };

  const bounce = () => {
    pop.setValue(1);
    Animated.sequence([
      Animated.timing(pop, { toValue: 0.86, duration: 90, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 3.5, tension: 120, useNativeDriver: true }),
    ]).start();
  };

  // A wrong PIN should feel like a no, not like a label changing.
  useEffect(() => {
    if (mood === 'sad' || mood === 'locked') {
      shake.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
      bounce();
    }
    if (mood === 'sad') setTears((n) => n + 1);
    if (mood === 'love' || mood === 'happy') { burst(); bounce(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, beat]);

  useEffect(() => {
    Animated.timing(bubble, {
      toValue: say ? 1 : 0, duration: 220, useNativeDriver: true,
    }).start();
  }, [say, bubble]);

  const head = size;
  const headH = size * 0.84;
  const faceW = size * 0.74;
  const faceH = size * 0.46;
  const eyeW = size * 0.115;
  const gap = size * 0.16;

  const eyeRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      {[0, 1].map((i) => {
        if (mood === 'locked') {
          // Shut. Two crosses, which is the only face here that means "no".
          return (
            <View key={i} style={{ width: eyeW * 1.3, height: eyeW * 1.3 }}>
              {[45, -45].map((deg) => (
                <View
                  key={deg}
                  style={{
                    position: 'absolute', top: eyeW * 0.58, left: 0,
                    width: eyeW * 1.3, height: eyeW * 0.16,
                    borderRadius: eyeW * 0.08, backgroundColor: eyeColor,
                    transform: [{ rotate: deg + 'deg' }],
                  }}
                />
              ))}
            </View>
          );
        }
        if (mood === 'sleepy') {
          return (
            <View
              key={i}
              style={{
                width: eyeW * 1.25, height: eyeW * 0.16,
                borderRadius: eyeW * 0.08, backgroundColor: eyeColor,
              }}
            />
          );
        }
        if (mood === 'happy' || mood === 'love') {
          // Eyes squeezed shut with pleasure: an arch, open side down.
          return (
            <View
              key={i}
              style={{
                width: eyeW * 1.35, height: eyeW * 0.78,
                borderTopLeftRadius: eyeW * 0.8, borderTopRightRadius: eyeW * 0.8,
                borderWidth: eyeW * 0.2, borderBottomWidth: 0, borderColor: eyeColor,
              }}
            />
          );
        }
        const small = mood === 'sad';
        return (
          <Animated.View
            key={i}
            style={{
              width: small ? eyeW * 0.8 : eyeW,
              height: small ? eyeW * 0.8 : eyeW,
              borderRadius: eyeW,
              backgroundColor: eyeColor,
              transform: [{ scaleY: blink }],
            }}
          >
            <View
              style={{
                position: 'absolute', top: eyeW * 0.14, right: eyeW * 0.14,
                width: eyeW * 0.26, height: eyeW * 0.26, borderRadius: eyeW * 0.13,
                backgroundColor: '#FFFFFF', opacity: 0.9,
              }}
            />
          </Animated.View>
        );
      })}
    </View>
  );

  const mouth = (() => {
    if (mood === 'love') {
      return (
        <View style={{ marginTop: size * 0.05 }}>
          <Heart w={size * 0.13} color={HEART} />
        </View>
      );
    }
    if (mood === 'sad') {
      return (
        <View
          style={{
            marginTop: size * 0.07, width: size * 0.16, height: size * 0.08,
            borderTopLeftRadius: size * 0.09, borderTopRightRadius: size * 0.09,
            borderWidth: size * 0.022, borderBottomWidth: 0, borderColor: eyeColor,
          }}
        />
      );
    }
    if (mood === 'locked') {
      return (
        <View
          style={{
            marginTop: size * 0.075, width: size * 0.17, height: size * 0.025,
            borderRadius: size * 0.02, backgroundColor: eyeColor,
          }}
        />
      );
    }
    if (mood === 'sleepy') {
      return (
        <View
          style={{
            marginTop: size * 0.065, width: size * 0.07, height: size * 0.07,
            borderRadius: size * 0.05, borderWidth: size * 0.02, borderColor: eyeColor,
          }}
        />
      );
    }
    const w = mood === 'happy' ? size * 0.22 : size * 0.16;
    return (
      <View
        style={{
          marginTop: size * 0.06, width: w, height: size * 0.09,
          borderBottomLeftRadius: w, borderBottomRightRadius: w,
          borderWidth: size * 0.022, borderTopWidth: 0, borderColor: eyeColor,
        }}
      />
    );
  })();

  const body = (
    <Animated.View
      style={{
        alignItems: 'center',
        transform: [
          { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [3, -4] }) },
          { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.07, size * 0.07] }) },
          { scale: pop },
          { rotate: mood === 'sad' ? '-7deg' : '0deg' },
        ],
      }}
    >
      {/* ears */}
      <View style={{ flexDirection: 'row', gap: size * 0.16, marginBottom: -size * 0.05 }}>
        {[-14, 14].map((deg) => (
          <View
            key={deg}
            style={{
              width: size * 0.13, height: size * 0.3, borderRadius: size * 0.08,
              backgroundColor: SHELL, borderWidth: 1.5, borderColor: SHELL_EDGE,
              alignItems: 'center', justifyContent: 'center',
              transform: [{ rotate: deg + 'deg' }],
            }}
          >
            <View
              style={{
                width: size * 0.05, height: size * 0.17, borderRadius: size * 0.03,
                backgroundColor: EAR_IN, opacity: mood === 'locked' ? 0.35 : 0.85,
              }}
            />
          </View>
        ))}
      </View>

      {/* head */}
      <View
        style={{
          width: head, height: headH, borderRadius: size * 0.3,
          backgroundColor: SHELL, borderWidth: 2, borderColor: SHELL_EDGE,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* blush */}
        <View
          style={{
            position: 'absolute', left: size * 0.05, top: headH * 0.58,
            width: size * 0.15, height: size * 0.08, borderRadius: size * 0.08,
            backgroundColor: BLUSH,
            opacity: mood === 'love' ? 0.85 : mood === 'happy' ? 0.5 : mood === 'locked' ? 0.12 : 0.28,
          }}
        />
        <View
          style={{
            position: 'absolute', right: size * 0.05, top: headH * 0.58,
            width: size * 0.15, height: size * 0.08, borderRadius: size * 0.08,
            backgroundColor: BLUSH,
            opacity: mood === 'love' ? 0.85 : mood === 'happy' ? 0.5 : mood === 'locked' ? 0.12 : 0.28,
          }}
        />

        {/* face screen */}
        <View
          style={{
            width: faceW, height: faceH, borderRadius: size * 0.2,
            backgroundColor: FACE, borderWidth: 1.5, borderColor: '#1B2330',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {eyeRow}
          {mouth}
        </View>
      </View>

      {/* collar */}
      <View
        style={{
          width: size * 0.42, height: size * 0.07, borderRadius: size * 0.04,
          backgroundColor: SHELL_EDGE, marginTop: -size * 0.02,
        }}
      />
    </Animated.View>
  );

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      {!!say && (
        <Animated.View
          style={[
            st.bubble,
            {
              opacity: bubble,
              transform: [
                { translateY: bubble.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
              ],
            },
          ]}
        >
          <Text style={st.bubbleText}>{say}</Text>
        </Animated.View>
      )}

      <View style={{ width: size * 1.7, alignItems: 'center', justifyContent: 'flex-end' }}>
        {/* Hearts, thrown off whenever something goes right. */}
        {rise.map((v, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute', bottom: size * 0.5,
              left: size * (0.28 + i * 0.32),
              opacity: v.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 1.1] }) },
                {
                  translateX: v.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, i % 2 ? size * 0.12 : -size * 0.12, 0],
                  }),
                },
                { scale: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1, 0.7] }) },
              ],
            }}
          >
            <Heart w={size * 0.17} color={HEART} />
          </Animated.View>
        ))}

        {/* One tear per disappointment, so a second wrong PIN looks worse. */}
        {mood === 'sad' && (
          <Animated.View
            key={tears}
            pointerEvents="none"
            style={{
              position: 'absolute', top: size * 0.62, right: size * 0.3,
              width: size * 0.07, height: size * 0.1, borderRadius: size * 0.05,
              backgroundColor: '#63C8FF',
              opacity: float.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.25] }),
              transform: [
                { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.3] }) },
              ],
            }}
          />
        )}

        {mood === 'sleepy' && (
          <Animated.Text
            pointerEvents="none"
            style={{
              position: 'absolute', top: 0, right: size * 0.1,
              color: T.vaultInkSoft, fontSize: size * 0.2, fontWeight: '700',
              opacity: antenna.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.9] }),
            }}
          >
            z
          </Animated.Text>
        )}

        {onPress || onLongPress ? (
          <Pressable
            onPress={() => { bounce(); burst(); onPress?.(); }}
            onLongPress={onLongPress}
            delayLongPress={500}
            hitSlop={8}
          >
            {body}
          </Pressable>
        ) : (
          body
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  bubble: {
    maxWidth: 230, backgroundColor: T.vaultCard, borderRadius: 14,
    borderWidth: 1, borderColor: T.vaultLine,
    paddingHorizontal: 14, paddingVertical: 9, marginBottom: 10,
  },
  bubbleText: { color: T.vaultInk, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
});
