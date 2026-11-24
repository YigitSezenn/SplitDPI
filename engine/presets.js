'use strict';
// Türkiye'de erişim engeli bulunan servisler için hazır alan adı listeleri.
// Alt alan adları otomatik kapsanır (cdn.ornek.com, www.ornek.com ...).

const PRESETS = {
  discord: {
    name: 'Discord',
    desc: 'Uygulama, web, ses sunucuları ve CDN',
    domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media',
      'discordcdn.com', 'discord.dev', 'discord.new', 'discord.gift', 'discordstatus.com', 'dis.gd'],
  },
  roblox: {
    name: 'Roblox',
    desc: 'Oyun, web sitesi ve içerik sunucuları',
    domains: ['roblox.com', 'rbxcdn.com', 'rbx.com', 'rbxtrk.com', 'robloxlabs.com'],
  },
  wattpad: {
    name: 'Wattpad',
    desc: 'Hikâye platformu',
    domains: ['wattpad.com', 'wattpad.net'],
  },
};

/** Seçili hazır listeler + kullanıcının kendi alan adları → tek liste */
function buildDomains(presets = [], custom = []) {
  const set = new Set();
  for (const key of presets) for (const d of (PRESETS[key] ? PRESETS[key].domains : [])) set.add(d);
  for (const d of custom) set.add(String(d).trim().toLowerCase().replace(/^\*?\./, ''));
  set.delete('');
  return [...set];
}

module.exports = { PRESETS, buildDomains };
