import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GuideArticle } from '@shiv/shared';
import { checkedMonth } from '@shiv/shared';
import { readGuide } from '../../state/ask';
import { cacheKeys, readCache, writeCache } from '../../state/cache';
import { say } from '../../state/net';
import { Notice } from '../../ui/Notice';
import { Screen, TopBar } from '../../ui/Screen';
import { C, headingScale, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** A guide article, kept on the phone once opened so it reads offline. */
export function ArticleScreen({ slug }: { slug: string }) {
  const [article, setArticle] = useState<GuideArticle | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void readCache<GuideArticle>(cacheKeys.guide(slug)).then((saved) => {
      if (active && saved?.data?.sections) setArticle((old) => old ?? saved.data);
    });
    void readGuide<GuideArticle>(slug)
      .then((fresh) => {
        if (!active) return;
        setArticle(fresh);
        setError('');
        void writeCache(cacheKeys.guide(slug), fresh);
      })
      .catch((e) => {
        if (active) setError(say(e));
      });
    return () => {
      active = false;
    };
  }, [slug]);
  return (
    <Screen topBar={<TopBar title={article?.title ?? w('ask.guide')} />}>
      {error && !article ? <Notice tone="error">{error}</Notice> : null}
      {article ? (
        <>
          <Text style={T.head} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
            {article.title}
          </Text>
          <Text style={[T.small, styles.quiet]}>
            {article.checkedOn
              ? w('ask.checkedBy', { month: checkedMonth(article.checkedOn) })
              : w('ask.notChecked')}
          </Text>
          {article.sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={T.title}>{section.heading}</Text>
              {section.blocks.map((block, index) => (
                <Text key={index} selectable style={T.body}>
                  {block}
                </Text>
              ))}
            </View>
          ))}
        </>
      ) : !error ? (
        <Text style={[T.body, styles.quiet]}>{w('common.loading')}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  quiet: { color: C.ink2 },
  section: { gap: space[2] },
});
