import { Fragment } from 'react';

export function PathText({ value }: { value: string }) {
   // Windows paths need explicit break points after separators
   const segments = value.split(/(?<=[\\/])/);

   return (
      <>
         {segments.map((segment, index) => (
            <Fragment key={index}>
               {segment}
               <wbr />
            </Fragment>
         ))}
      </>
   );
}
