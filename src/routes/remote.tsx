import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/remote')({
   component: RemoteRoute
});

function RemoteRoute() {
   return <div className="text-sm">wip</div>;
}
