const mechanicalSuffixPattern = /(?:_\d{3,}|\s*\(\d+\))+$/;
const releaseNamePattern = /^(?:beat saber\s+)?v?\d+\.\d+(?:\.\d+)?$/i;
const genericFolderNames = new Set(['beat saber', 'beatsaber']);

export function stripMechanicalSuffix(folderName: string) {
   const trimmed = folderName.trim();

   return trimmed.replace(mechanicalSuffixPattern, '').trim() || trimmed;
}

export function customInstallName(folderName: string) {
   const cleaned = stripMechanicalSuffix(folderName);
   if (!cleaned || releaseNamePattern.test(cleaned) || genericFolderNames.has(cleaned.toLowerCase())) return null;

   return cleaned;
}
