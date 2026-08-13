import type { ModSummary } from '@/modules/mods/contract';

export type ModGroup = {
   id: string;
   category: string;
   label: string;
   mods: ModSummary[];
};

const categoryOrder = [
   'core',
   'essential',
   'leaderboards',
   'multiplayer',
   'lighting',
   'gameplay',
   'cosmetic',
   'ui',
   'tweaks',
   'streamtools',
   'other',
   'library'
];
const leaderboardNames = ['beatleader', 'scoresaber', 'localleaderboard'];

function categoryRank(category: string) {
   const rank = categoryOrder.indexOf(category);

   return rank === -1 ? categoryOrder.indexOf('other') - 0.5 : rank;
}

function groupCategory(mod: ModSummary) {
   if (mod.category !== 'other') return mod.category;

   const compactName = compactModName(mod.name);

   if (compactName.includes('scoresabersharp')) return 'library';

   return leaderboardNames.some((name) => compactName.includes(name)) ? 'leaderboards' : mod.category;
}

function compactModName(name: string) {
   return name.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function shuffleModFamilies(mods: ModSummary[]) {
   const families = new Map<string, ModSummary[]>();
   for (const mod of mods) {
      const key = compactModName(mod.name);
      const family = families.get(key) ?? [];
      family.push(mod);
      families.set(key, family);
   }

   const shuffled = [...families.values()];
   for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      const current = shuffled[index];
      const selected = shuffled[other];
      if (!current || !selected) continue;
      shuffled[index] = selected;
      shuffled[other] = current;
   }
   mods.splice(0, mods.length, ...shuffled.flat());
}

export function groupMods(mods: ModSummary[], label: (category: string) => string) {
   const groups = new Map<string, ModGroup>();

   for (const mod of mods) {
      const category = groupCategory(mod);
      const id = `category:${category.toLowerCase()}`;
      const group = groups.get(id) ?? {
         id,
         category,
         label: label(category),
         mods: []
      };

      group.mods.push(mod);
      groups.set(id, group);
   }

   const leaderboards = groups.get('category:leaderboards');
   if (leaderboards) shuffleModFamilies(leaderboards.mods);

   return [...groups.values()].sort(compareGroups);
}

export function orderModGroups(groups: ModGroup[], order: string[]) {
   if (order.length === 0) return groups;

   const byId = new Map(groups.map((group) => [group.id, group]));
   const ordered: ModGroup[] = [];
   for (const id of order) {
      const group = byId.get(id);
      if (!group) continue;

      ordered.push(group);
      byId.delete(id);
   }

   return [...ordered, ...byId.values()];
}

function compareGroups(first: ModGroup, second: ModGroup) {
   const ranked = categoryRank(first.category) - categoryRank(second.category);
   if (ranked !== 0) return ranked;

   return first.label.localeCompare(second.label);
}
