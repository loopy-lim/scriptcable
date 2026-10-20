/**
 * Example RN screen using the scriptcable core through useCable.
 * Copy this pattern into your Expo / RN CLI app.
 */
import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, Button } from 'react-native';
import { useCable } from './useCable';

export default function App() {
  const add = useCable('add');
  const greet = useCable('greet');
  const [sum, setSum] = useState<number | null>(null);
  const [hi, setHi] = useState('');

  useEffect(() => {
    greet('react-native').then(setHi).catch(console.error);
  }, [greet]);

  return (
    <SafeAreaView style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>scriptcable + React Native</Text>
      <Text>{hi}</Text>
      <Text>sum: {sum ?? '—'}</Text>
      <Button title="add(20, 22)" onPress={() => add(20, 22).then(setSum).catch(console.error)} />
    </SafeAreaView>
  );
}
