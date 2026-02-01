'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSettings } from '@/components/settings/profile';
import { TagsSettings } from '@/components/settings/tags';
import { GroupsSettings } from '@/components/settings/groups';
import { SmartListsSettings } from '@/components/settings/smart-lists';
import { ApiKeysSettings } from '@/components/settings/api-keys';
import { BlocklistSettings } from '@/components/settings/blocklist';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
        <h1 className="text-3xl font-bold">Settings</h1>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="smart-lists">Smart Lists</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="blocklist">Blocklist</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileSettings />
          </TabsContent>

          <TabsContent value="tags">
            <TagsSettings />
          </TabsContent>

          <TabsContent value="groups">
            <GroupsSettings />
          </TabsContent>

          <TabsContent value="smart-lists">
            <SmartListsSettings />
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysSettings />
          </TabsContent>

          <TabsContent value="blocklist">
            <BlocklistSettings />
          </TabsContent>
        </Tabs>
    </div>
  );
}
