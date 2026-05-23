import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TwitchDeviceLink } from "@/components/TwitchDeviceLink";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { api } from "@/lib/api";

export function TwitchLinkPage() {
  const navigate = useNavigate();

  const onLinked = async () => {
    await api.minerReload().catch(() => undefined);
    navigate("/dashboard");
  };

  return (
    <DashboardPage>
      <DashboardScrollArea className="max-w-lg space-y-4 pb-2">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold sm:text-2xl">Link Twitch</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Connect your Twitch account so Dropforge can mine drops for you.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Twitch device login</CardTitle>
            <CardDescription>Same flow as initial setup — enter the code at twitch.tv/activate</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TwitchDeviceLink onLinked={onLinked} />
            <Button variant="ghost" className="w-full" onClick={() => navigate("/dashboard/settings")}>
              Back to settings
            </Button>
          </CardContent>
        </Card>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
