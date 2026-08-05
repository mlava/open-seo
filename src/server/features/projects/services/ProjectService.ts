import {
  archiveProject,
  createProject,
  getProjectForOrganization,
  listArchivedProjects,
  listProjects,
  listProjectsEnsuringOne,
  restoreProject,
  setProjectDomain,
  setProjectMarket,
  setRapidapiEnabled,
  updateProject,
} from "@/server/features/projects/services/projects";

export const ProjectService = {
  listProjects,
  listProjectsEnsuringOne,
  createProject,
  updateProject,
  setProjectDomain,
  setProjectMarket,
  setRapidapiEnabled,
  archiveProject,
  restoreProject,
  listArchivedProjects,
  getProjectForOrganization,
} as const;
