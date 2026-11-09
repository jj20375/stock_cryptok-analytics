/** @component 生辰表單：國曆／農曆、時辰不明、性別；送出到 /metaphysics action 加密保存，亦可刪除。 */
import { Form, useNavigation } from 'react-router';
import type { BirthInput } from '../../services/metaphysics/baziProfile';

const field = 'w-full rounded border border-current/20 bg-transparent px-2 py-1';

export function BirthProfileForm({ birth }: { birth: BirthInput | null }) {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <div className="space-y-3">
      <Form method="post" className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="intent" value="saveBirth" />
        <label className="text-sm">曆法
          <select name="calendar" defaultValue={birth?.calendar ?? 'solar'} className={field}>
            <option value="solar">國曆</option><option value="lunar">農曆</option>
          </select>
        </label>
        <label className="text-sm">性別（決定大運順逆）
          <select name="gender" defaultValue={birth?.gender ?? 'male'} className={field}>
            <option value="male">男</option><option value="female">女</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2 text-sm sm:col-span-2">
          <label>年<input name="year" inputMode="numeric" defaultValue={birth?.year ?? ''} required className={field} /></label>
          <label>月<input name="month" inputMode="numeric" defaultValue={birth?.month ?? ''} required className={field} /></label>
          <label>日<input name="day" inputMode="numeric" defaultValue={birth?.day ?? ''} required className={field} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isLeapMonth" defaultChecked={birth?.isLeapMonth ?? false} />農曆閏月</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hourUnknown" defaultChecked={birth?.hourUnknown ?? false} />時辰不明</label>
        <div className="grid grid-cols-2 gap-2 text-sm sm:col-span-2">
          <label>時（0–23）<input name="hour" inputMode="numeric" defaultValue={birth && !birth.hourUnknown ? birth.hour : ''} className={field} /></label>
          <label>分<input name="minute" inputMode="numeric" defaultValue={birth && !birth.hourUnknown ? birth.minute : ''} className={field} /></label>
        </div>
        <p className="text-xs opacity-65 sm:col-span-2">
          生辰加密保存，只用於你自己的命盤。子時以 23:00 換日；1937–1979 年間台灣時鐘快一小時的時段會自動修正。
        </p>
        <button disabled={busy} className="rounded border border-current/40 px-4 py-2 text-sm sm:col-span-2">{busy ? '保存中…' : '保存生辰'}</button>
      </Form>
      {birth && (
        <Form method="post" onSubmit={(e) => { if (!confirm('確定刪除生辰資料？個人解說快取也會一併刪除。')) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="deleteBirth" />
          <button disabled={busy} className="text-xs text-rose-300 underline">刪除我的生辰資料</button>
        </Form>
      )}
    </div>
  );
}
