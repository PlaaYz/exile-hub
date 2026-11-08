-- Exile Hub driver for Path of Building's engine (headless). Loaded after HeadlessWrapper.lua.
-- Answers one question for the campaign: which support gems make the build's main skill hit
-- harder right now, and what they do to its mana cost.
--
-- ehSuggest(jsonRequest) -> jsonResponse
--   request:  { xml?, xmlKey, level, candidates = { { id, name }, ... }, maxSupports = 3 }
--   response: { ok, error?, skill, skillLevel, base = Stats, singles = { Single }, combo = { Step }, ms }
-- The character is approximated as a campaign one: no passive tree, no items except weapons
-- (attack skills need them). Gem levels follow the character level.

local json = require("dkjson")
local clock = os.clock

local loadedKey = nil
local mainActive = nil -- { gemId, name }

local function gemLevelFor(gemData, charLevel)
  local best = 1
  local levels = gemData.grantedEffect and gemData.grantedEffect.levels or {}
  for l = 1, 20 do
    local lv = levels[l]
    if lv and (lv.levelRequirement or 1) <= charLevel then best = l end
  end
  return best
end

local function isSupport(gemData)
  return gemData and gemData.grantedEffect and gemData.grantedEffect.support
end

-- Candidates come from exile-leveling data, whose ids differ from PoB's for supports
-- ("SupportGemArcaneSurge" vs "SkillGemSupportArcaneSurge"): try the id, the PoB spelling, the name.
local function resolveGem(c)
  local gems = build.data.gems
  if gems[c.id] then return c.id end
  local alt = c.id:gsub("/SupportGem", "/SkillGemSupport")
  if gems[alt] then return alt end
  local byName = build.data.gemForBaseName and c.name and build.data.gemForBaseName[(c.name .. " Support"):lower()]
  if byName and gems[byName] then return byName end
  return nil
end

local function stripToCampaign()
  -- no passives
  build.spec:ResetNodes()
  build.spec:BuildAllDependsAndPaths()
  -- no gear except weapons
  for slotName, slot in pairs(build.itemsTab.slots) do
    if not slotName:match("^Weapon") and slot.selItemId and slot.selItemId ~= 0 then
      slot:SetSelItemId(0)
    end
  end
  build.itemsTab:PopulateSlots()
end

local function findMainActive()
  local groups = build.skillsTab.socketGroupList
  local main = groups[build.mainSocketGroup] or groups[1]
  if not main then return nil end
  for _, gem in ipairs(main.gemList) do
    if gem.enabled ~= false and gem.gemData and not isSupport(gem.gemData) then
      return { gemId = gem.gemData.id, name = gem.gemData.name }
    end
  end
  return nil
end

local function setGroup(gemIds, charLevel)
  local tab = build.skillsTab
  wipeTable(tab.socketGroupList)
  local group = { label = "exilehub", enabled = true, gemList = {}, slot = "Body Armour", mainActiveSkill = 1 }
  for _, id in ipairs(gemIds) do
    local gd = build.data.gems[id]
    table.insert(group.gemList, {
      gemId = id, level = gemLevelFor(gd, charLevel), quality = 0, enabled = true, count = 1,
      enableGlobal1 = true, enableGlobal2 = true,
    })
  end
  table.insert(tab.socketGroupList, group)
  tab:ProcessSocketGroup(group)
  build.mainSocketGroup = 1
  build.buildFlag = true
  runCallback("OnFrame")
end

local function stats()
  local o = build.calcsTab.mainOutput or {}
  local src = (o.Minion and (o.Minion.CombinedDPS or 0) > 0) and o.Minion or o
  local dps = src.CombinedDPS or src.TotalDPS or 0
  local costPerSec = o.ManaPerSecondCost or 0
  local regen = o.ManaRegenRecovery or o.ManaRegen or 0
  local mana = o.Mana or 0
  local sustain = -1 -- seconds of non-stop casting before running dry; -1 = regen keeps up
  if costPerSec > regen then sustain = mana / (costPerSec - regen) end
  return {
    dps = dps,
    cost = o.ManaCost or 0,
    costPerSec = costPerSec,
    regen = regen,
    mana = mana,
    sustain = sustain,
  }
end

local function measure(ids, level)
  setGroup(ids, level)
  return stats()
end

function ehSuggest(reqText)
  local t0 = clock()
  local ok, res = pcall(function()
    local req = json.decode(reqText)
    if req.xmlKey ~= loadedKey then
      if not req.xml then return { ok = false, error = "need-xml" } end
      loadBuildFromXML(req.xml, "exilehub")
      mainActive = findMainActive()
      stripToCampaign()
      loadedKey = req.xmlKey
    end
    if not mainActive then return { ok = false, error = "Não achei a habilidade principal do build no PoB." } end
    local level = math.max(1, math.min(100, req.level or 1))
    build.characterLevel = level
    build.characterLevelAutoMode = false

    local activeData = build.data.gems[mainActive.gemId]
    local activeReq = activeData.grantedEffect.levels[1] and activeData.grantedEffect.levels[1].levelRequirement or 1
    if activeReq > level then
      return { ok = false, soft = true, error = string.format("%s precisa do nível %d.", mainActive.name, activeReq) }
    end

    local base = measure({ mainActive.gemId }, level)
    local singles = {}
    local pobIdOf = {} -- our id -> PoB id
    for _, c in ipairs(req.candidates or {}) do
      local pid = resolveGem(c)
      local gd = pid and build.data.gems[pid]
      if gd and isSupport(gd) then
        pobIdOf[c.id] = pid
        local s = measure({ mainActive.gemId, pid }, level)
        if base.dps > 0 and s.dps > base.dps * 1.005 then
          s.id = c.id -- answer with the caller's id (it knows where to get the gem)
          s.name = gd.name
          s.level = gemLevelFor(gd, level)
          s.gain = s.dps / base.dps - 1
          table.insert(singles, s)
        end
      end
    end
    table.sort(singles, function(a, b) return a.dps > b.dps end)

    -- greedy links: best support, then the best one to add to it, ... (top 12 singles only)
    local combo, chosen = {}, { mainActive.gemId }
    local pool = {}
    for i = 1, math.min(12, #singles) do pool[i] = singles[i].id end
    local prev = base
    for _ = 1, math.min(req.maxSupports or 3, #pool) do
      local bestId, best = nil, nil
      for _, id in ipairs(pool) do
        local pid = pobIdOf[id]
        local used = false
        for _, c in ipairs(chosen) do if c == pid then used = true end end
        if not used then
          local ids = { unpack(chosen) }
          table.insert(ids, pid)
          local s = measure(ids, level)
          if not best or s.dps > best.dps then bestId, best = id, s end
        end
      end
      if not best or best.dps <= prev.dps * 1.005 then break end
      table.insert(chosen, pobIdOf[bestId])
      best.id = bestId
      best.name = build.data.gems[pobIdOf[bestId]].name
      best.gain = best.dps / base.dps - 1
      table.insert(combo, best)
      prev = best
    end

    return {
      ok = true,
      skill = mainActive.name,
      skillLevel = gemLevelFor(activeData, level),
      base = base,
      singles = singles,
      combo = combo,
    }
  end)
  if not ok then res = { ok = false, error = tostring(res) } end
  res.ms = math.floor((clock() - t0) * 1000)
  return json.encode(res)
end
