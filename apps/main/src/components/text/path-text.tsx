import { Fragment } from 'react';

export function PathText({ value }: { value: string }) {
   // Windows paths need explicit break points after separators
   const segments = value.split(/(?<=[\\/])/);
   let end = 0;

   return (
      <>
         {segments.map((segment) => {
            end += segment.length;
            return (
               <Fragment key={end}>
                  {segment}
                  <wbr />
               </Fragment>
            );
         })}
      </>
   );
}
