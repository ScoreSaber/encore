import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
   appId: 'com.scoresaber.encore',
   appName: 'Encore',
   webDir: 'dist',
   loggingBehavior: 'none',
   android: {
      allowMixedContent: false,
      backgroundColor: '#101014'
   },
   ios: {
      backgroundColor: '#101014',
      contentInset: 'automatic'
   },
   plugins: {
      Nodejs: {
         nodeDir: 'nodejs',
         startMode: 'manual'
      }
   }
};

export default config;
