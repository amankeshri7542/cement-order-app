import { Component, Fragment, type ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reportError } from './platform/monitoring';
import { Button } from './ui/Button';
import { Mark } from './ui/Icon';
import { C, space, T } from './ui/tokens';
import { w } from './words';

type State = { failed: boolean; attempt: number };

/** Last line of defence: a screen that fails to draw shows a way back, not a blank or crashed app. */
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
          backgroundColor: C.ground,
          padding: space[5],
          justifyContent: 'center',
          gap: space[4],
        }}
      >
        <Mark size={48} />
        <Text style={T.display}>{w('boundary.title')}</Text>
        <Text style={T.body}>{w('boundary.body')}</Text>
        <Button
          icon="refresh"
          onPress={() => this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }))}
        >
          {w('common.retry')}
        </Button>
      </SafeAreaView>
    );
  }
}
