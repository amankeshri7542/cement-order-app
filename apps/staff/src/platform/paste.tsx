// Only in a local Android test build (EXPO_PUBLIC_STAFF_PASTE=1). The emulator has no way to be
// shown a QR, so a long press on the scan title opens this box. See camera use in screens/scan.tsx;
// the import there sits behind the same build-time switch, so a production bundle has none of it.
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Btn, Txt } from '../ui';
import { colors, space } from '../ui/tokens';
import type { Tr } from '../logic/words';

export function PasteCode(props: { tr: Tr; onCode(text: string): void }) {
  const [text, setText] = useState('');
  return (
    <View style={{ gap: space.sm, padding: space.md, backgroundColor: colors.paper }}>
      <Txt>{props.tr('staff.scan.paste')}</Txt>
      <TextInput
        testID="paste-code"
        value={text}
        onChangeText={setText}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        style={{
          minHeight: 64,
          fontSize: 18,
          borderWidth: 1.5,
          borderColor: colors.ink,
          color: colors.ink,
          paddingHorizontal: space.md,
        }}
      />
      <Btn
        testID="paste-go"
        kind="solid"
        label={props.tr('staff.scan.pasteGo')}
        onPress={() => props.onCode(text.trim().toUpperCase())}
      />
    </View>
  );
}
