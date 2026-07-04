import './styles/index.scss';
import { addCollection } from '@iconify/svelte';
import featherIcons from '@iconify-json/feather/icons.json';
import materialSymbolsIcons from '@iconify-json/material-symbols/icons.json';
import mdiIcons from '@iconify-json/mdi/icons.json';
import { mount } from 'svelte';
import App from './App.svelte';

// Pre-load all icon sets offline — required for Electron (no CDN access)
addCollection(featherIcons);
addCollection(materialSymbolsIcons);
addCollection(mdiIcons);

const app = mount(App, {
    target: document.getElementById('app')!
});

export default app;
