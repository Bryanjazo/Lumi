// Top-level error boundary so one screen's render crash doesn't
// white-screen the whole app. Wrapped around the Stack in _layout.tsx.
//
// The boundary stays VERY low-key on purpose: no scary stack traces,
// no "Send report" CTA, no Sentry yet. Just a calm "something broke
// — try again" panel that lets the user reload back into the app.
// In __DEV__ we surface the actual error text so we can fix it
// during development.

import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { fonts } from '../constants/fonts';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
  ember: '#E07A4F',
} as const;

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Always log — production users won't see this, but TestFlight +
    // dev console will, so we can triage what crashed.
    console.warn(
      '[ErrorBoundary] caught',
      error.message,
      info.componentStack ?? '(no stack)',
    );
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SOMETHING BROKE</Text>
          <Text style={styles.h1}>
            Lumi tripped on something.
          </Text>
          <Text style={styles.body}>
            Tap below to reload — your data is safe. If this keeps
            happening, restart the app.
          </Text>
          {__DEV__ && (
            <Text style={styles.devMsg}>
              {this.state.error.message}
            </Text>
          )}
          <Pressable onPress={this.reset} style={styles.cta}>
            <Text style={styles.ctaText}>Reload</Text>
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
    fontSize: 26,
    lineHeight: 32,
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
