import { Module } from "@nestjs/common";
import { GithubReleaseAdapter } from "./github.adapter";
import { GiteeReleaseAdapter, GitlabReleaseAdapter } from "./unimplemented.adapter";

@Module({
  providers: [GithubReleaseAdapter, GiteeReleaseAdapter, GitlabReleaseAdapter],
  exports: [GithubReleaseAdapter, GiteeReleaseAdapter, GitlabReleaseAdapter],
})
export class ProvidersModule {}
