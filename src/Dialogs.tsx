import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, color, Heading, useReducedMotion } from './ui';

type Action = { label: string; run: () => void; destructive?: boolean };
type DialogRequest = { title: string; message: string; action?: Action };

const DialogContext = createContext<(request: DialogRequest) => void>(() => {
  throw new Error('Nimby dialogs require DialogProvider');
});

export function useDialog() {
  return useContext(DialogContext);
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, show] = useState<DialogRequest | null>(null);
  const reduced = useReducedMotion();
  const dismiss = () => show(null);

  return <DialogContext.Provider value={show}>
    {children}
    {request && <Modal transparent visible hardwareAccelerated statusBarTranslucent navigationBarTranslucent
      animationType={reduced ? 'none' : 'fade'} onRequestClose={dismiss}>
      <SafeAreaView style={layout.backdrop}>
        <View style={layout.panel} accessibilityViewIsModal>
          <ScrollView style={layout.scroll} contentContainerStyle={layout.message} bounces={false}>
            <Heading>{request.title}</Heading>
            <Body>{request.message}</Body>
          </ScrollView>
          {request.action ? <View style={layout.actions}>
            <Button label={request.action.label} destructive={request.action.destructive} run={() => {
              const action = request.action;
              dismiss();
              action?.run();
            }} />
            <Button label="Cancel" subtle run={dismiss} />
          </View> : <Button label="Done" run={dismiss} />}
        </View>
      </SafeAreaView>
    </Modal>}
  </DialogContext.Provider>;
}

const layout = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#000000A8' },
  panel: { width: '100%', maxWidth: 420, maxHeight: '100%', borderRadius: 20, backgroundColor: color.white,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule, padding: 20, gap: 16 },
  scroll: { flexGrow: 0 },
  message: { gap: 8 },
  actions: { gap: 8 },
});
