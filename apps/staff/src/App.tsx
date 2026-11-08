import { useEffect, type ComponentType } from 'react';
import { AppState, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  boot,
  clearLateAnswer,
  flush,
  getApp,
  lookAgain,
  noteOnline,
  refreshToday,
  startSender,
  useApp,
} from './core';
import { kaamMode } from './logic/kaam';
import { punchOutcome, refusedOutcome, type PunchReply } from './logic/outcome';
import { NavProvider, useNav } from './nav';
import { OutcomeFlood } from './screens/flood';
import { DayScreen, QueryScreen, RecordScreen } from './screens/record';
import {
  CashScreen,
  DeliveredScreen,
  StopProblemScreen,
  StopScreen,
  TripHome,
} from './screens/drive';
import { HazriHome, ProblemScreen, ProblemSend } from './screens/hazri';
import {
  CodeScreen,
  CutOffScreen,
  NoticeScreen,
  NumberScreen,
  RefusedScreen,
  WaitingScreen,
  YoursScreen,
} from './screens/link';
import { PaisaHome, SlipScreen } from './screens/paisa';
import { PhotoScreen } from './screens/photo';
import { ScanScreen } from './screens/scan';
import { TopBar, TabBar } from './screens/shell';
import {
  CountScreen,
  DamageScreen,
  LoadDoneScreen,
  MoreScreen,
  PickScreen,
  StockHome,
  TransferReceiveScreen,
  TransfersScreen,
  TruckScreen,
} from './screens/stock';
import { Choice, Screen, Txt } from './ui';
import { colors } from './ui/tokens';
import { ThemeProvider } from './ui/theme';

type Params = { params?: Record<string, unknown> };
const routes: Record<string, ComponentType<Params>> = {
  scan: ScanScreen,
  problem: ProblemScreen,
  problemSend: ProblemSend,
  photo: PhotoScreen,
  record: RecordScreen,
  day: DayScreen,
  query: QueryScreen,
  slip: SlipScreen,
  loadDone: LoadDoneScreen,
  more: MoreScreen,
  pick: PickScreen,
  truck: TruckScreen,
  damage: DamageScreen,
  count: CountScreen,
  transfers: TransfersScreen,
  transferReceive: TransferReceiveScreen,
  stop: StopScreen,
  delivered: DeliveredScreen,
  stopProblem: StopProblemScreen,
  cash: CashScreen,
  stock: () => <StockHome />,
  trip: () => <TripHome />,
};

function KaamHome() {
  const { tr, today } = useApp();
  const nav = useNav();
  const mode = kaamMode(today?.access ?? []);
  if (mode === 'stock') return <StockHome tabs />;
  if (mode === 'drive') return <TripHome tabs />;
  return (
    <Screen testID="screen-kaam" top={<TopBar />} tabs={<TabBar />}>
      {mode === 'both' ? (
        <>
          <Choice
            testID="kaam-stock"
            icon="box"
            label={tr('staff.kaam.stock')}
            onPress={() => nav.push('stock')}
          />
          <Choice
            testID="kaam-trip"
            icon="truck"
            label={tr('staff.kaam.trip')}
            onPress={() => nav.push('trip')}
          />
        </>
      ) : (
        <Txt testID="kaam-none">{tr('staff.kaam.none')}</Txt>
      )}
    </Screen>
  );
}

/** Screens that hand something back to the form under them, which must keep what was typed. */
const overlays = new Set(['photo', 'pick']);

/** The screen to show, once the phone is linked. */
function Linked() {
  const nav = useNav();
  const { stack } = nav;
  if (stack.length) {
    let from = stack.length - 1;
    while (from > 0 && overlays.has(stack[from]!.name)) from--;
    return (
      <>
        {stack.slice(from).map((route, offset) => {
          const index = from + offset;
          const Page = routes[route.name];
          if (!Page) return null;
          return (
            <View
              key={`${index}-${route.name}`}
              style={index === stack.length - 1 ? { flex: 1 } : { display: 'none' }}
            >
              <Page {...(route.params ? { params: route.params } : {})} />
            </View>
          );
        })}
      </>
    );
  }
  if (nav.tab === 'kaam') return <KaamHome />;
  if (nav.tab === 'paisa') return <PaisaHome />;
  return <HazriHome />;
}

/** A scan answered after the person moved on still gets its moment. */
function LateAnswer() {
  const { lateAnswer, tr, today } = useApp();
  if (!lateAnswer) return null;
  const done = () => {
    clearLateAnswer();
    void refreshToday().catch(() => {});
  };
  const outcome = lateAnswer.refused
    ? refusedOutcome(lateAnswer.refused, tr)
    : punchOutcome(lateAnswer.body as PunchReply, tr, { arrivedAt: today?.arrivedAt ?? null });
  return (
    <OutcomeFlood
      testID="flood-late"
      outcome={{ ...outcome, actions: ['home'] }}
      on={{ home: done }}
    />
  );
}

function Stage() {
  const { stage } = useApp();
  const nav = useNav();
  // Leaving work for any other stage drops what was open, so a screen from before a cut-off or a
  // sign-in can never come back with someone's data on it.
  useEffect(() => {
    if (stage !== 'READY' && stage !== 'WAITING' && stage !== 'NEW_PHONE') {
      nav.setTab('hazri');
    }
  }, [stage]);
  switch (stage) {
    case 'BOOT':
      return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
    case 'NUMBER':
      return <NumberScreen />;
    case 'CODE':
      return <CodeScreen />;
    case 'YOURS':
      return <YoursScreen />;
    case 'NOTICE':
      return <NoticeScreen />;
    case 'WAITING':
    case 'NEW_PHONE':
      return <LinkedWaiting newPhone={stage === 'NEW_PHONE'} />;
    case 'REFUSED':
      return <RefusedScreen />;
    case 'CUT_OFF':
      return <CutOffScreen />;
    case 'READY':
      return (
        <>
          <Linked />
          <LateAnswer />
        </>
      );
  }
}
function LinkedWaiting({ newPhone }: { newPhone: boolean }) {
  const nav = useNav();
  const top = nav.stack[nav.stack.length - 1];
  if (top?.name === 'scan') return <ScanScreen {...(top.params ? { params: top.params } : {})} />;
  return <WaitingScreen newPhone={newPhone} />;
}

export default function App() {
  useEffect(() => {
    void boot();
    startSender();
    // Only "is there a network": no extra requests to anyone else to test it.
    NetInfo.configure({ reachabilityShouldRun: () => false });
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected === false) noteOnline(false);
      if (state.isConnected === true) noteOnline(true);
    });
    // Coming back to the app: send what waits, read the day again, and notice a changed switch.
    const active = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || getApp().stage !== 'READY') return;
      void flush();
      void refreshToday().catch(() => {});
      lookAgain();
    });
    return () => {
      net();
      active.remove();
    };
  }, []);
  return (
    // Light until the screens move to useStyles (phases B5 and G1); then "auto" follows the phone.
    <ThemeProvider choice="light">
      <SafeAreaProvider>
        <NavProvider>
          <Stage />
        </NavProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
