// Per-tab error boundary — a render crash in ONE tab must not take
// down the whole app. The root ErrorBoundary still backstops the
// navigation shell, but each tab screen wraps itself in this so a
// data-driven crash in (say) Patterns shows a calm in-tab card while
// Home / Time / Untangle / Me keep working — and switching tabs is
// itself the escape hatch the old root-only design didn't have
// (its Reload re-rendered the same crashed tree in a loop).

import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { fonts } from '../constants/fonts';
import { reportError } from '../lib/errorReport';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  hair: '#2A2420',
  ember: '#E07A4F',
} as const;

interface Props {
  /** Which tab this wraps — goes into the crash report context. */
  tab: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.warn(
      `[TabErrorBoundary:${this.props.tab}] caught`,
      error.message,
      info.componentStack ?? '(no stack)',
    );
    reportError(error, `tab:${this.props.tab}`, true);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>A HICCUP</Text>
          <Text style={styles.h1}>This room needs a moment.</Text>
          <Text style={styles.body}>
            Something in this tab stumbled — your data is safe, and the
            other tabs still work. Try again, or come back in a bit.
          </Text>
          {__DEV__ && (
            <Text style={styles.devMsg}>{this.state.error.message}</Text>
          )}
          <Pressable onPress={this.reset} style={styles.cta}>
            <Text style={styles.ctaText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.void,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hair,
    padding: 24,
    gap: 12,
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    color: C.boneDim,
    fontSize: 10.5,
    letterSpacing: 1.4,
  },
  h1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.bone,
    fontSize: 24,
    lineHeight: 30,
  },
  body: {
    fontFamily: fonts.inter,
    color: C.boneDim,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  devMsg: {
    fontFamily: fonts.inter,
    color: C.ember,
    fontSize: 11.5,
    lineHeight: 16,
    backgroundColor: C.void2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.hair,
    padding: 10,
    marginBottom: 8,
    alignSelf: 'stretch',
  },
  cta: {
    backgroundColor: C.ember,
    borderRadius: 100,
    paddingVertical: 12,
    paddingHorizontal: 22,
    marginTop: 4,
  },
  ctaText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 13.5,
    letterSpacing: 0.2,
  },
});
