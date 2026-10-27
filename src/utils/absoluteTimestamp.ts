/** Exact ISO/RFC3339 calendar time; excludes Date.parse's comment/date-only syntax. */
export function isAbsoluteTimestamp(value:unknown):value is string{
  if(typeof value!=='string')return false;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!parts)return false;
  const [year,month,day,hour,minute,second]=parts.slice(1,7).map(Number);
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  return year>=1 && month>=1 && month<=12 && day>=1 && day<=days && hour<24 && minute<60 && second<60
    && (parts[7]===undefined || Number(parts[7])<16 && Number(parts[8])<60) && Number.isFinite(Date.parse(value));
}
