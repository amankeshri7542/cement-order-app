import { memo } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import heroPlate from '../../assets/art/hero.webp';
import emptyPlate from '../../assets/art/home.webp';
import balu from '../../assets/art/sp-balu.webp';
import bricks from '../../assets/art/sp-bricks.webp';
import cement from '../../assets/art/sp-cement.webp';
import gitti from '../../assets/art/sp-gitti.webp';
import hardware from '../../assets/art/sp-hardware.webp';
import pipes from '../../assets/art/sp-pipes.webp';
import sariya from '../../assets/art/sp-sariya.webp';
import tractorPlate from '../../assets/art/tractor.webp';

// Drawings ship inside the app as WebP, and each is a flat, small file. Tiles are out everywhere
// (decision 51), and a material without a drawing simply has none.
const drawings: Record<string, ImageSourcePropType> = {
  cement,
  steel: sariya,
  sand: balu,
  aggregates: gitti,
  bricks,
  pipes,
  hardware,
};

/** One specimen per material heading, in the new state only. Decorative, so TalkBack skips it. */
export const Specimen = memo(function Specimen({
  slug,
  size = 88,
}: {
  slug: string;
  size?: number;
}) {
  const source = drawings[slug];
  if (!source) return null;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.box}>
      <Image source={source} resizeMode="contain" style={{ width: size, height: size * 0.8 }} />
    </View>
  );
});

export { heroPlate, tractorPlate, emptyPlate };

const styles = StyleSheet.create({ box: { flexShrink: 0 } });
