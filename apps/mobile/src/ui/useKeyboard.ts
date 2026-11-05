import { useEffect, useState } from 'react';
import { Dimensions, Keyboard } from 'react-native';

/**
 * Below this is not a keyboard. On Android 10 a sheet's translucent window makes the system report a
 * "keyboard" the size of the status and navigation bars, which left screens short by that much.
 */
const SMALLEST_KEYBOARD = 120;

/** How much of the screen the keyboard covers, in dp, measured up from the bottom of the screen. */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const covered = Dimensions.get('screen').height - event.endCoordinates.screenY;
      setHeight(covered >= SMALLEST_KEYBOARD ? covered : 0);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return height;
}
