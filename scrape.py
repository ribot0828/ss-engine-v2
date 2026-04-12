from http.server import BaseHTTPRequestHandler
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query_components = urllib.parse.parse_qs(parsed_path.query)
        url = query_components.get('url', [None])[0]
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not url:
            self.wfile.write(json.dumps({"error": "URL is required"}).encode('utf-8'))
            return

        try:
            data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def audit_horse_history(self, horse_id, current_grade):
        if not horse_id or horse_id == "不明": return "-"
        url = f"https://db.netkeiba.com/horse/{horse_id}/"
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            res = requests.get(url, headers=headers, timeout=5)
            res.encoding = 'euc-jp'
            soup = BeautifulSoup(res.text, 'html.parser')
            table = soup.select_one('table.db_h_race_results')
            if not table: return "NG (データ無)"
            rows = table.select('tbody tr')
            checked = 0
            for row in rows:
                if checked >= 5: break
                cols = row.select('td')
                if len(cols) < 19: continue
                race_name = cols[4].get_text().strip()
                rank = cols[11].get_text().strip()
                diff = cols[18].get_text().strip()
                is_same = current_grade in race_name or (current_grade == "OP" and "オープン" in race_name)
                if not is_same and 'G' in current_grade:
                    m = re.search(r'G[1-3]', race_name)
                    if m and m.group(0) in current_grade: is_same = True
                if is_same:
                    checked += 1
                    try:
                        val = float(diff.replace('+', '').replace('-', ''))
                        if val <= 1.0: return "合格"
                    except:
                        if rank == "1" or not diff or diff.startswith('-'): return "合格"
            return "不合格"
        except: return "エラー"

    def scrape_netkeiba(self, url):
        # 1. URLの正規化 (スマホ版をPC版に強制変換)
        match = re.search(r'race_id=(\d+)', url)
        race_id = match.group(1) if match else None
        is_result = 'result.html' in url or 'pid=race_result' in url
        
        if race_id:
            page_type = 'result' if is_result else 'shutuba'
            url = f"https://race.netkeiba.com/race/{page_type}.html?race_id={race_id}"

        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        res = requests.get(url, headers=headers)
        res.encoding = 'euc-jp'
        soup = BeautifulSoup(res.text, 'html.parser')

        # 2. メタ情報の抽出
        name_elem = soup.select_one(".RaceName") or soup.select_one(".Race_Name") or soup.select_one("h1.RaceName")
        race_name = name_elem.get_text().strip() if name_elem else ""

        # ---- 日付の確実な取得 ----
        date_info = ""
        if soup.title:
            title_text = soup.title.get_text()
            date_match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', title_text)
            if date_match:
                date_info = f"{date_match.group(1)}-{date_match.group(2).zfill(2)}-{date_match.group(3).zfill(2)}"
        
        if not date_info:
            date_info = datetime.now().strftime("%Y-%m-%d")
        # ------------------------

        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box")
        course_info = ""
        if course_elem:
            t = course_elem.get_text(separator=' ').strip()
            t = re.sub(r'\s+', ' ', t)
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', t).split('特集')[0].strip()

        grade_info = ""
        grade_icon = soup.select_one('.Icon_GradeType')
        if grade_icon:
            grade_info = grade_icon.get_text().strip().replace('GⅠ', 'G1').replace('GⅡ', 'G2').replace('GⅢ', 'G3')
        
        if not grade_info:
            # レース名やコース情報からクラスを推測
            look_text = race_name + " " + course_info
            # 優先度の高い順に検索
            patterns = [
                r'(G1|G2|G3|GⅠ|GⅡ|GⅢ)',
                r'(オープン|OP)',
                r'([1-3]勝クラス)',
                r'(新馬|未勝利)',
                r'(J\.G[1-3])',
                r'(重賞)'
            ]
            for p in patterns:
                gm = re.search(p, look_text)
                if gm:
                    grade_info = gm.group(1).replace('GⅠ', 'G1').replace('GⅡ', 'G2').replace('GⅢ', 'G3')
                    break
        
        if not grade_info: grade_info = "一般"

        # 3. 馬リストの抽出
        horses = []
        seen_umaban = set()

        if is_result:
            table = soup.select_one(".ResultTable") or soup.select_one("table[summary='全着順']")
            if table:
                # 1. ヘッダーから列のインデックスを動的に取得
                header_elems = table.select("th")
                headers = [th.get_text().strip() for th in header_elems]
                umaban_idx = 2
                pop_idx = 9
                odds_idx = 10
                
                for i, h in enumerate(headers):
                    if '馬番' in h: umaban_idx = i
                    elif '人気' in h: pop_idx = i
                    elif '単勝' in h: odds_idx = i

                # 2. 取得したインデックスを使って安全にデータを抽出
                for row in table.select("tr"):
                    cols = row.select("td")
                    if len(cols) <= max(umaban_idx, pop_idx, odds_idx): continue
                    try:
                        umaban_txt = cols[umaban_idx].get_text().strip()
                        umaban = int(re.sub(r'\D', '', umaban_txt))
                        
                        name_a = row.select_one("a[href*='/horse/']")
                        name = name_a.get_text().strip().replace('\n', ' ') if name_a else "不明"
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        
                        # 改行をスペースに置換してCSV破壊を防ぐ
                        pop = cols[pop_idx].get_text().strip().replace('\n', ' ')
                        odds_txt = cols[odds_idx].get_text().strip().replace(',', '').replace('---.-', '0.0').replace('\n', ' ')
                        
                        try:
                            odds = float(odds_txt)
                        except ValueError:
                            odds = 0.0

                        if umaban in seen_umaban: continue
                        seen_umaban.add(umaban)
                        horses.append({
                            "umaban": umaban, "name": name, "horse_id": hid, 
                            "odds": odds, "popular": pop, "rank": "B", 
                            "placing": cols[0].get_text().strip().replace('\n', ' '), "audit": "-"
                        })
                    except Exception as e:
                        pass
        else:
            for row in soup.select(".HorseList"):
                try:
                    num_e = row.select_one("td[class^='Umaban']") or row.select_one(".Umaban") or row.select_one(".Horse_Num")
                    if not num_e: continue
                    umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                    name_a = row.select_one(".HorseName a") or row.select_one("a[href*='/horse/']")
                    name = name_a.get_text().strip()
                    hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                    odds_e = row.select_one(".Odds") or row.select_one("td.Txt_R")
                    odds = float(odds_e.get_text().strip().replace('---.-', '0.0')) if odds_e else 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": "", "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 4. 琥珀監査の実行
        cg = grade_info.split(' ')[0]
        for h in horses: h["audit"] = self.audit_horse_history(h["horse_id"], cg)

        # 5. 払戻金の取得
        payouts = {}
        for tbl in (soup.select('.Payout_Detail_Table') or soup.select('.Payout_Table')):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                tn = th.get_text().strip()
                tds = tr.select('td')
                if len(tds) >= 2:
                    val = tds[1].get_text(separator=' ').strip().replace('\n', ' ')
                    if '単勝' in tn: payouts['単勝'] = val
                    if 'ワイド' in tn: payouts['ワイド'] = val
                    if '3連複' in tn or '３連複' in tn: payouts['3連複'] = val

        return {
            "race_name": race_name, "venue": "", "race_num": "",
            "course_info": course_info, "grade_info": grade_info, 
            "date_info": date_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]), 
            "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }
