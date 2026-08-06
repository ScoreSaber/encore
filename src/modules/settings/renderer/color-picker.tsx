import { useState } from 'react';

import { HexColorPicker } from 'react-colorful';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type ColorPickerProps = {
   disabled?: boolean;
   inputLabel: string;
   label: string;
   value: string;
   onChange: (value: string) => void;
};

function parseHexColor(value: string) {
   const hex = value.trim().replace(/^#/, '');
   if (/^[0-9a-f]{3}$/i.test(hex)) {
      return `#${hex.replace(/./g, '$&$&').toLowerCase()}`;
   }
   return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}

export function ColorPicker({ disabled, inputLabel, label, value, onChange }: ColorPickerProps) {
   const [open, setOpen] = useState(false);
   const [storedDraft, setDraft] = useState(() => ({ source: value, color: value, input: value }));
   let draft = storedDraft;

   if (storedDraft.source !== value) {
      draft = { source: value, color: value, input: value };
      setDraft(draft);
   }

   function commitColor(color: string) {
      setDraft({ ...draft, color, input: color });
      if (color !== value) onChange(color);
   }

   function commitHexInput() {
      const color = parseHexColor(draft.input);
      if (color === undefined) {
         setDraft({ ...draft, input: draft.color });
         return;
      }
      commitColor(color);
   }

   return (
      <Popover
         open={open}
         onOpenChange={(nextOpen) => {
            if (!nextOpen) commitHexInput();
            setOpen(nextOpen);
         }}
      >
         <PopoverTrigger asChild>
            <Button
               type="button"
               variant="ghost"
               size="icon-sm"
               className="border shadow-xs"
               disabled={disabled}
               aria-label={label}
               style={{ backgroundColor: value }}
            />
         </PopoverTrigger>
         <PopoverContent className="flex w-60 flex-col gap-3">
            <HexColorPicker
               aria-label={label}
               className="encore-color-picker"
               color={draft.color}
               onChange={(color) => {
                  setDraft({ ...draft, color, input: color });
               }}
               onChangeEnd={commitColor}
            />
            <Input
               aria-label={inputLabel}
               aria-invalid={parseHexColor(draft.input) === undefined}
               autoCapitalize="none"
               autoComplete="off"
               maxLength={7}
               placeholder="#rrggbb"
               spellCheck={false}
               value={draft.input}
               onBlur={commitHexInput}
               onChange={(event) => setDraft({ ...draft, input: event.currentTarget.value })}
               onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                     commitHexInput();
                     event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                     setDraft({ source: value, color: value, input: value });
                     setOpen(false);
                  }
               }}
            />
         </PopoverContent>
      </Popover>
   );
}
