import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
   component: HomeRoute
});

function HomeRoute() {
   return <div className="text-sm">wip</div>;
}
