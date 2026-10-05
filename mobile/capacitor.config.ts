import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jamesai.app',
  appName: 'James AI',
  webDir: 'public',
  server: {
    url: 'https://YOUR-JAMESAI-DOMAIN.example.com',
    cleartext: false
  }
};

export default config;
