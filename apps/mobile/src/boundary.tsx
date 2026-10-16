import { Component, Fragment, type ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space } from '@shiv/shared';
import { reportError } from './monitoring';
import { Button, C, Stamp, s } from './ui';

type State = { failed: boolean; attempt: number };

/**
 * Last line of defence: a screen that fails to draw (say, an unexpected reply from the store)
 * shows a way back instead of a blank or crashed app. Both languages are shown because the
 * chosen language lives in the part of the app that just failed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    reportError(error);
  }
  render() {
    // A new key starts the app afresh, so Try again does not reuse the state that failed.
    if (!this.state.failed)
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    return (
      <SafeAreaView
        accessibilityRole="alert"
        style={{
          flex: 1,
          backgroundColor: C.paper,
          padding: space.xl,
          justifyContent: 'center',
          gap: space.lg,
        }}
      >
        <Stamp size={64} />
        <Text style={s.h1}>कुछ गड़बड़ हो गई · Something went wrong</Text>
        <Text style={s.body}>
          यह स्क्रीन दिखाने में दिक्कत हुई। कृपया फिर कोशिश करें। · The app had a problem showing
          this screen. Please try again.
        </Text>
        <Button
          icon="refresh"
          label="Try again"
          onPress={() => this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }))}
        >
          फिर कोशिश करें · Try again
        </Button>
      </SafeAreaView>
    );
  }
}
