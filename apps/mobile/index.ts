import { registerRootComponent } from 'expo';
import App from './src/App';
import { withMonitoring } from './src/platform/monitoring';
registerRootComponent(withMonitoring(App));
