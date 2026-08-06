import { createFileRoute } from "@tanstack/react-router";
import { AiCitationTrackingPage } from "@/client/features/ai-citation-tracking/AiCitationTrackingPage";

export const Route = createFileRoute(
  "/_project/p/$projectId/ai-citation-tracking",
)({ component: AiCitationTrackingRoute });
function AiCitationTrackingRoute() {
  const { projectId } = Route.useParams();
  return <AiCitationTrackingPage projectId={projectId} />;
}
