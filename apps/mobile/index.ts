import { registerRootComponent } from 'expo';
import App from './src/App';
import { withMonitoring } from './src/monitoring';
registerRootComponent(withMonitoring(App));
