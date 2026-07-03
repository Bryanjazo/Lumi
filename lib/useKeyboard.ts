// Lumi · keyboard height hook
//
// One shared listener for "how tall is the keyboard right now" so
// keyboard-adjacent surfaces (Untangle's chat input, Home's capture
// pill) can reposition themselves instead of being buried or floating
// too high. iOS uses the Will* events (fire before the animation, so
// UI moves WITH the keyboard); Android only reliably emits Did*.

import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';

export const useKeyboardHeight = (): number => {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
};
