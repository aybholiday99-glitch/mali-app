import type {ConflictReviewToken,FinancialConflictSnapshot} from '../services/conflictResolutionCore';
import type {SyncResult} from '../services/supabaseSyncCore';
export interface CloudConflictReview {
  token:Readonly<ConflictReviewToken>;
  local:Readonly<FinancialConflictSnapshot>;
  cloud:Readonly<FinancialConflictSnapshot>;
  attempted:Readonly<FinancialConflictSnapshot>;
  originalCloud:Readonly<FinancialConflictSnapshot>;
}
export interface CloudConflictResolutionResult extends SyncResult {review?:CloudConflictReview}
