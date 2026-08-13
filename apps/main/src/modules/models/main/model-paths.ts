import { toSafeFileName } from '@/lib/filesystem/path';
import { modelTypes, type ModelType } from '@/modules/models/contract';

import { extname, join } from 'node:path';

const modelFolderNames = {
   avatar: 'CustomAvatars',
   bloq: 'CustomNotes',
   platform: 'CustomPlatforms',
   saber: 'CustomSabers',
   wall: 'CustomWalls'
};

const modelExtensions = {
   avatar: '.avatar',
   bloq: '.bloq',
   platform: '.plat',
   saber: '.saber',
   wall: '.wall'
};

export function modelFolderName(type: ModelType) {
   return modelFolderNames[type];
}

export function modelExtension(type: ModelType) {
   return modelExtensions[type];
}

export function modelFolderPath(rootPath: string, type: ModelType) {
   return join(rootPath, modelFolderNames[type]);
}

export function modelTypeForFileName(fileName: string): ModelType | null {
   const extension = extname(fileName).toLowerCase();

   return modelTypes.find((type) => modelExtensions[type] === extension) ?? null;
}

export function modelDisplayName(fileName: string) {
   const extension = extname(fileName);

   return extension ? fileName.slice(0, -extension.length) : fileName;
}

export function toSafeModelFileName(name: string, type: ModelType, fallback: string) {
   const extension = modelExtensions[type];
   const base = extname(name).toLowerCase() === extension ? modelDisplayName(name) : name;

   return `${toSafeFileName(base, fallback)}${extension}`;
}
