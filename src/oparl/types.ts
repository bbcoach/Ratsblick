/**
 * Teilmenge der OParl-Objekte (Spezifikation 1.0 und 1.1), soweit Ratsblick sie nutzt.
 * Alle Felder außer `id` sind optional, weil Implementierungen sie unterschiedlich vollständig liefern.
 * Spezifikation: https://oparl.org/spezifikation/
 */

export interface OParlBase {
  id: string;
  type?: string;
  created?: string;
  modified?: string;
  deleted?: boolean;
  web?: string;
}

export interface OParlSystem extends OParlBase {
  oparlVersion?: string;
  name?: string;
  body?: string;
  vendor?: string;
  product?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
}

export interface OParlBody extends OParlBase {
  name?: string;
  shortName?: string;
  ags?: string;
  rgs?: string;
  website?: string;
  organization?: string;
  person?: string;
  meeting?: string;
  paper?: string;
}

export interface OParlOrganization extends OParlBase {
  name?: string;
  shortName?: string;
  organizationType?: string;
  classification?: string;
  startDate?: string;
  endDate?: string;
}

export interface OParlFile extends OParlBase {
  name?: string;
  fileName?: string;
  mimeType?: string;
  date?: string;
  size?: number;
  accessUrl?: string;
  downloadUrl?: string;
}

export interface OParlLocation extends OParlBase {
  description?: string;
  streetAddress?: string;
  room?: string;
  postalCode?: string;
  locality?: string;
}

export interface OParlAgendaItem extends OParlBase {
  meeting?: string;
  number?: string;
  order?: number;
  name?: string;
  public?: boolean;
  consultation?: string;
  result?: string;
  resolutionText?: string;
}

export interface OParlMeeting extends OParlBase {
  name?: string;
  meetingState?: string;
  cancelled?: boolean;
  start?: string;
  end?: string;
  /** In der Praxis mal eingebettetes Objekt, mal URL. */
  location?: OParlLocation | string;
  organization?: string[];
  invitation?: OParlFile;
  resultsProtocol?: OParlFile;
  verbatimProtocol?: OParlFile;
  auxiliaryFile?: OParlFile[];
  agendaItem?: OParlAgendaItem[];
}

export interface OParlConsultation extends OParlBase {
  paper?: string;
  agendaItem?: string;
  meeting?: string;
  organization?: string[];
  authoritative?: boolean;
  role?: string;
}

export interface OParlPaper extends OParlBase {
  name?: string;
  reference?: string;
  date?: string;
  paperType?: string;
  mainFile?: OParlFile;
  auxiliaryFile?: OParlFile[];
  consultation?: OParlConsultation[];
}

export interface OParlListResponse<T> {
  data: T[];
  links?: { first?: string; prev?: string; next?: string; last?: string };
  pagination?: Record<string, unknown>;
}

/** Fehlerobjekt laut Spezifikation, z. B. {"type":".../Error","message":"OParl is not active."} */
export interface OParlErrorObject {
  type: string;
  message?: string;
  debug?: string;
}
