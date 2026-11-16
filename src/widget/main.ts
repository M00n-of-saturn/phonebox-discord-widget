// Punto de entrada del widget dentro del iframe de PhoneBox. window.phonebox lo define el panel.

import { VoicePanel } from './components/VoicePanel.ts';
import { PhoneBoxClient, type PhoneBoxApi } from './services/PhoneBoxClient.ts';

const api = (window as unknown as { phonebox?: PhoneBoxApi }).phonebox;
const root = document.getElementById('discord-panel');

if (api && root) {
  const client = new PhoneBoxClient(api);
  const panel = new VoicePanel(document, root, client);
  client.onView((view) => panel.render(view));
}
