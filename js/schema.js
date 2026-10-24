// Typed layout of the whole Wild World save (main block, 0x15FE0 bytes), from the decompilation's SaveData and its
// sub-records. Used by the Save Explorer. A field is [name, offset, type, note?]; a type is a primitive name, or
// { t: 'str'|'bytes', n }, { t: 'bits', size, fields: [[name, shift, width]] }, { t: 'array', of, n, stride },
// or { t: 'struct', s: 'Name' }. 'bytes' marks data whose meaning isn't known yet; known: true marks raw data with a known
// purpose (pixels, bitsets) that has its own editor elsewhere.
(function () {
  'use strict';
  const str = n => ({ t: 'str', n }), bytes = n => ({ t: 'bytes', n }), raw = n => ({ t: 'bytes', n, known: true }), st = s => ({ t: 'struct', s });
  const arr = (of, n, stride) => ({ t: 'array', of, n, stride });
  const bits = (size, fields) => ({ t: 'bits', size, fields });

  const S = {
    TownId: { size: 0xA, fields: [['Town ID', 0x0, 'u16'], ['Town name', 0x2, str(8)]] },
    PlayerId: { size: 0x16, fields: [['Town ID', 0x0, 'u16'], ['Town name', 0x2, str(8)], ['Player ID', 0xA, 'u16'], ['Name', 0xC, str(8)], ['Gender', 0x14, 'u8', '0 boy, 1 girl'], ['Padding', 0x15, 'u8']] },
    VillagerId: { size: 0xC, fields: [['Town ID', 0x0, 'u16'], ['Town name', 0x2, str(8)], ['Personality', 0xA, 'personality'], ['Species', 0xB, 'species']] },
    ClockDate: { size: 4, fields: [['Day', 0, 'u8'], ['Month', 1, 'u8'], ['Year', 2, 'u8', '2000 + year'], ['Padding', 3, 'u8']] },
    DateTime: { size: 8, fields: [['Second', 0, 'u8'], ['Minute', 1, 'u8'], ['Hour', 2, 'u8'], ['Day', 3, 'u8'], ['Month', 4, 'u8'], ['Year', 5, 'u8'], ['Padding', 6, 'u16']] },
    ClockOffset: { size: 8, fields: [['Minutes', 0, 's32', 'Added to the DS clock'], ['Seconds', 4, 's16'], ['Padding', 6, 'u16']] },
    ItemClassOrders: { size: 9, fields: ['Furniture', 'Stationery', 'Shirts', 'Carpets', 'Wallpaper', 'Accessories', 'Hats', 'Umbrellas', 'Full headwear'].map((n, i) => [n, i, 'u8', i ? undefined : '0–5: which of the classes A, B, C is most common']) },
    LostChildRecord: { size: 0xC, fields: [['Her town', 0, st('TownId')], ['State', 0xA, bits(1, [['Days left', 0, 4], ['Kaitlin is the one lost', 4, 1], ['Being escorted', 5, 1], ['Unused', 6, 2]])], ['Padding', 0xB, 'u8']] },
    GyroidBeats: { size: 8, fields: [['Positions', 0, arr(bits(1, [['X', 0, 4], ['Y', 4, 4]]), 4, 1)], ['In use', 4, bits(1, [['Gyroid 1', 0, 1], ['Gyroid 2', 1, 1], ['Gyroid 3', 2, 1], ['Gyroid 4', 3, 1], ['Unused', 4, 4]])], ['Beats', 5, arr(bits(1, [['First', 0, 4], ['Second', 4, 4]]), 2, 1)], ['Padding', 7, 'u8']] },
    TownStart: { size: 5, fields: [['Founded on', 0, st('ShopDate')], ['First day', 3, 'u8', 'Non-zero until the first day ends'], ['Padding', 4, 'u8']] },
    ErrandRecord: { size: 0xC, fields: [['Given at', 0, st('DateTime')], ['Item', 8, 'item'], ['Kind', 0xA, 'u8', '0–21 an errand, 22 none'], ['Step', 0xB, bits(1, [['Step', 0, 5], ['Extra', 5, 3]])]] },
    ErrandSlot: { size: 0x28, fields: [['Errand', 0, st('ErrandRecord')], ['Villagers', 0xC, arr(st('VillagerId'), 2, 0xC)], ['Present reaction', 0x24, 'u8'], ['Padding', 0x25, raw(3)]] },
    ParcelErrand: { size: 0x10, fields: [['Errand', 0, st('ErrandRecord')], ['Recipient', 0xC, 'u8'], ['Recipients left', 0xD, 'u8'], ['Padding', 0xE, 'u16']] },
    HouseVisit: { size: 0x24, fields: [['Host', 0, st('VillagerId')], ['Errand', 0xC, st('ErrandRecord')], ['Visit time', 0x18, 'u32'], ['Visit time (high)', 0x1C, 'u32'], ['Accepted', 0x20, 'u8'], ['Unused', 0x21, raw(3)]] },
    PlayerErrands: { size: 0xAC, fields: [['Errands', 0, arr(st('ErrandSlot'), 2, 0x28)], ['Part-time job villagers', 0x50, arr(st('VillagerId'), 3, 0xC)], ['On duty', 0x74, 'u8'], ['Padding', 0x75, raw(3)], ['Parcel errand', 0x78, st('ParcelErrand')], ['House visit invite', 0x88, st('HouseVisit')]] },
    FriendEntry: { size: 0x1C, fields: [['DWC friend data', 0, raw(0xC), 'Nintendo Wi-Fi friend code record'], ['Player name', 0xC, str(8)], ['Town name', 0x14, str(8)]] },
    FriendList: { size: 0x384, fields: [['Friends', 0, arr(st('FriendEntry'), 32, 0x1C)], ['Checksum', 0x380, 'u16', 'Fixed automatically on save'], ['Padding', 0x382, 'u16']] },
    WifiData: { size: 0x50, fields: [['DWC user data', 0, raw(0x40), 'Nintendo Wi-Fi login IDs'], ['Own friend data', 0x40, raw(0xC)], ['Checksum', 0x4C, 'u16', 'Fixed automatically on save'], ['Padding', 0x4E, 'u16']] },
    DramaRecord: { size: 5, fields: [['Last part', 0, bits(1, [['Field A', 0, 2], ['Field B', 2, 3], ['Field C', 5, 3]])], ['Watched on', 1, st('ClockDate')]] },
    MotherLetters: { size: 0x13, fields: [['Last letter', 0, st('ShopDate')], ['Birthday letter year', 3, 'u8'], ['Letters sent', 4, raw(15), 'One bit per letter from Mom']] },
    VillagerPlan: { size: 0x24, fields: [['Plan set at', 0, st('DateTime')], ['State set at', 8, st('DateTime')], ['State', 0x10, 'u8', '0–7 current hobby, 8 changing hobby, 10 moving in; 9 and 11 are other plan states'], ['Hobby scores', 0x11, arr('u8', 8, 1), 'Bugs, fish, fossils, clothes, furniture, gardening, shells, walks'], ['Pending scores', 0x19, arr('u8', 8, 1)], ['Flags', 0x21, bits(1, [['Came from state 2', 0, 1], ['Unused', 1, 7]])], ['Padding', 0x22, raw(2), 'Never read or written by the game (VillagerPlan::unk_22)']] },
    PlanErrand: { size: 0x29, fields: [['Errand', 0, st('ErrandRecord')], ['For player', 0xC, st('PlayerId')], ['Step', 0x22, 'u8'], ['Padding', 0x23, 'u8'], ['Item shown', 0x24, 'item'], ['Count', 0x26, 'u8'], ['Fossil group', 0x27, 'u8'], ['Flags', 0x28, 'u8']] },
    VillagerPlanBlock: { size: 0x50, fields: [['Plan', 0, st('VillagerPlan')], ['Planned errand', 0x24, st('PlanErrand')], ['Padding', 0x4D, raw(3)]] },
    SickVillager: { size: 0x90, fields: [['Errand', 0, st('ErrandRecord')], ['Villager', 0xC, st('VillagerId')], ['Visitors', 0x18, arr(st('PlayerId'), 5, 0x16)], ['Fell sick on', 0x86, st('ClockDate')], ['Status date', 0x8A, st('ClockDate')], ['Days sick', 0x8E, 'u8'], ['Padding', 0x8F, 'u8']] },
    BottleLetter: { size: 0xFC, fields: [['Letter', 0, st('Letter')], ['Messages used', 0xF4, raw(5), 'One bit per bottle message already sent'], ['Padding', 0xF9, raw(3)]] },
    ReceivedLetter: { size: 0xF8, fields: [['Letter', 0, st('Letter')], ['Checksum', 0xF4, 'u8', 'Fixed automatically on save'], ['Padding', 0xF5, raw(3), 'Rest of the exchange block’s unused bytes; covered by the checksum']] },
    TownEvent: { size: 0xC, fields: [['Event', 0, 'u16', 'Event number (see the calendar); 99 = free'], ['Year', 2, 'u8'], ['Padding', 3, 'u8'], ['Starts', 4, st('EventDate')], ['Ends', 8, st('EventDate')]] },
    EventDate: { size: 4, fields: [['Unused', 0, 'u8', '1 with the rest 0 = no date'], ['Hour', 1, 'u8'], ['Day', 2, 'u8'], ['Month', 3, 'u8']] },
    EventWeekSlot: { size: 6, fields: [['Day', 0, 'u8'], ['Month', 1, 'u8'], ['Event', 2, 'event', 'Which visitor; 99 = none'], ['State', 3, 'u8'], ['Happened', 4, 'u8'], ['Residents present', 5, 'u8', 'One bit per resident']] },
    EventWeekSlots: { size: 0x3C, fields: [['Created on', 0, st('ClockDate')], ['Refreshed on', 4, st('ClockDate')], ['Week marker A', 8, st('ClockDate')], ['Week marker B', 0xC, st('ClockDate')],
      ['Crazy Redd’s weekday', 0x10, 'u8', '1–5'], ['Event announced online', 0x11, 'event', 'The event shared while playing over Wi-Fi; 99 offline (EventAnnouncer)'], ['Today’s event', 0x12, 'event'], ['Today’s weekday', 0x13, 'u8'], ['Visitors this week', 0x14, arr(st('EventWeekSlot'), 5, 6)], ['Padding', 0x32, 'u16'], ['Week start', 0x34, arr('u32', 2, 4), 's64 timestamp']] },
    ShopDate: { size: 3, fields: [['Day', 0, 'u8'], ['Month', 1, 'u8'], ['Year', 2, 'u8']] },
    Pattern: { size: 0x228, fields: [['Pixels (32×32, 4 bits each)', 0x0, raw(0x200), 'Edit in the pattern editor'], ['Creator', 0x200, st('PlayerId')], ['Title', 0x216, str(16)],
      ['Palette and concept', 0x226, bits(1, [['Concept', 0, 4], ['Palette', 4, 4]])], ['Padding', 0x227, 'u8']] },
    Letter: { size: 0xF4, fields: [['Object header', 0x0, 'u32', 'Set by the game; 0 means an empty slot'], ['Recipient', 0x4, st('PlayerId')], ['Recipient kind', 0x1A, 'u8', '1 future self, 2 resident, 4 bottle, 5–6 special'], ['Padding', 0x1B, 'u8'], ['Sender', 0x1C, st('PlayerId')], ['Sender kind', 0x32, 'u8'], ['Padding', 0x33, 'u8'],
      ['Greeting', 0x34, str(24)], ['Body', 0x4C, str(128)], ['Sign-off', 0xCC, str(32)], ['Name position', 0xEC, 'u8'], ['Stationery', 0xED, 'u8'], ['Status', 0xEE, bits(1, [['State', 0, 6], ['Present state', 6, 2]]), 'State 1 draft, 2 unread, 3 read, 4–6 bottle, 7–8 from a villager'], ['Kind', 0xEF, 'u8', 'Template the game wrote it from'], ['Present', 0xF0, 'item'], ['Padding', 0xF2, 'u16']] },

    PlayerData: { size: 0x228C, fields: [
      ['Designs', 0x0, arr(st('Pattern'), 8, 0x228)], ['Design order', 0x1140, arr('u8', 8, 1), 'Display order of the 8 designs (PatternOrder)'],
      ['Pocket letters', 0x1148, arr(st('Letter'), 10, 0xF4)], ['Default greeting', 0x1AD0, str(24)], ['Future-self greeting', 0x1AE8, str(24)], ['Default sign-off', 0x1B00, str(32)], ['Name position', 0x1B20, 'u8'], ['Future-self name position', 0x1B21, 'u8'],
      ['Pockets', 0x1B22, arr('item', 15, 2)], ['Wallet', 0x1B40, 'u32'], ['Wallet padding', 0x1B44, 'u32'], ['Catalog and encyclopedia bits', 0x1B48, raw(0x123), 'Edit in Catalog'], ['Options', 0x1C6B, bits(1, [['Option bits', 0, 8]])],
      ['Letter to future self', 0x1C6C, st('Letter')], ['Future letter delivery', 0x1D60, st('ClockDate')], ['Errands', 0x1D64, st('PlayerErrands'), 'Favors from neighbors'],
      ['Wi-Fi identity (checksummed)', 0x1E10, st('WifiData')], ['Friend roster (checksummed)', 0x1E60, st('FriendList')],
      ['Savings', 0x21E4, 'u32'], ['Savings padding', 0x21E8, 'u32'], ['Emotions', 0x21EC, arr('emotion', 4, 1)], ['Daily talk date', 0x21F0, st('ShopDate')], ['Padding', 0x21F3, 'u8'], ['Daily talk flags', 0x21F4, raw(8), 'Edit in the resident’s Hidden flags › Today’s chats'], ['Event flags', 0x21FC, raw(8), 'Edit in Hidden flags'],
      ['Last daily update', 0x2204, st('ClockDate')], ['Nook Points', 0x2208, 'u16'], ['Held item', 0x220A, 'item'], ['Shirt', 0x220C, 'item'], ['Hat', 0x220E, 'item'], ['Face accessory', 0x2210, 'item'], ['Bed', 0x2212, 'item'], ['Pocket background', 0x2214, 'item'],
      ['Last played', 0x2216, bits(2, [['Year', 0, 7], ['Month', 7, 4], ['Day', 11, 5]])], ['Birthday day', 0x2218, 'u8'], ['Birthday month', 0x2219, 'u8'],
      ['Insurance date', 0x221A, st('ClockDate')], ['Part-time job date', 0x221E, st('ClockDate')], ['Chats with Sable', 0x2222, 'u8'], ['Roost visits', 0x2223, 'u8'], ['Haircuts', 0x2224, 'u8'], ['Acorns delivered', 0x2225, 'u8'], ['Acorn prize step', 0x2226, 'u8'], ['Resetti visits', 0x2227, 'u8'], ['Gracie style score', 0x2228, 'u8'], ['Insurance claims', 0x2229, 'u8'], ['Event entries', 0x222A, bits(1, [['Entered Fishing Tourney', 0, 1], ['Entered Bug-Off', 1, 1], ['Fireworks given (0–10)', 2, 4], ['Festival gift', 6, 1], ['Unused', 7, 1]])],
      ['Last show seen', 0x222B, st('DramaRecord')], ['Katie escort record', 0x2230, st('LostChildRecord')],
      ['Face and hairstyle', 0x223C, bits(1, [['Face', 0, 4], ['Hairstyle', 4, 4]])], ['Hair color, tan, fortune', 0x223D, bits(1, [['Hair color', 0, 3], ['Tan', 3, 3], ['Fortune', 6, 2]])],
      ['Mom’s letters', 0x223E, st('MotherLetters')], ['Part-time job talks', 0x2251, 'u8'], ['Balloons shot', 0x2252, 'u8'], ['Birthday talk year', 0x2253, 'u8'], ['Birthday reminder days', 0x2254, arr('u8', 8, 1), '0xFF = none'],
      ['Friend who moved away: town', 0x225C, st('TownId')], ['Friend who moved away: villager', 0x2266, st('VillagerId')], ['Friend who moved away: present', 0x2272, 'item'], ['Friend who moved away: friendship', 0x2274, 's8'], ['Friend who moved away: padding', 0x2275, 'u8'],
      ['Identity', 0x2276, st('PlayerId')]] },

    VillagerMemory: { size: 0x68, fields: [['Player', 0x0, st('PlayerId')], ['Nickname', 0x16, str(8)], ['Compliment', 0x1E, str(16)], ['Greeting', 0x2E, str(16)], ['Padding', 0x3E, 'u16'], ['Last talk', 0x40, st('DateTime')],
      ['Player’s town', 0x48, st('TownId')], ['Last gift', 0x52, 'item'], ['Friendship', 0x54, 's8'], ['Impression', 0x55, 'u8'], ['Padding', 0x56, 'u16'], ['Topics used', 0x58, 'u32'], ['Town tune heard', 0x5C, raw(8)],
      ['Memory flags', 0x64, bits(2, [['Letter received', 0, 1], ['Gift given', 4, 1], ['Fortune greeting', 5, 1], ['Talked today', 6, 1], ['Party gift', 7, 1], ['Talk streak', 8, 3], ['Party greeted', 11, 1], ['Birthday letter', 12, 1], ['New Year letter', 13, 1], ['Flea market', 14, 1]])], ['Padding', 0x66, 'u16']] },
    VillagerData: { size: 0x700, fields: [['Memories', 0x0, arr(st('VillagerMemory'), 8, 0x68)], ['Design', 0x340, st('Pattern')], ['Kept letter', 0x568, st('Letter')], ['Plans', 0x65C, st('VillagerPlanBlock'), 'Hobby, moving state and a planned errand'],
      ['Furniture', 0x6AC, arr('item', 10, 2)], ['Identity', 0x6C0, st('VillagerId')], ['Received items', 0x6CC, arr('item', 4, 2)], ['Moved from', 0x6D4, st('TownId')], ['Catchphrase', 0x6DE, str(10)], ['House X (+16)', 0x6E8, 'u8'], ['House Y (+16)', 0x6E9, 'u8'],
      ['Furniture on display', 0x6EA, bits(2, [['Mask', 0, 10]])], ['Shirt', 0x6EC, 'item'], ['Wallpaper', 0x6EE, 'u8'], ['Flooring', 0x6EF, 'u8'], ['Move-in kind', 0x6F0, 'u8'], ['Furniture taste', 0x6F1, 'u8'], ['Room layout', 0x6F2, 'u8'], ['Padding', 0x6F3, 'u8'], ['Umbrella', 0x6F4, 'u8'], ['Padding', 0x6F5, 'u8'], ['Letter’s town', 0x6F6, st('TownId')]] },

    Room: { size: 0x450, fields: [['Floor items', 0x0, arr('item', 256, 2)], ['Items on top', 0x200, arr('item', 256, 2)], ['Furniture switches (floor layer)', 0x400, arr('u16', 16, 2), 'One bit per spot (bit x of row y); 1 by default, 0 when a piece like a lamp or tape deck is switched'], ['Furniture switches (top layer)', 0x420, arr('u16', 16, 2)], ['Gyroids', 0x440, st('GyroidBeats')], ['Wallpaper', 0x448, 'item'], ['Flooring', 0x44A, 'item'], ['Music', 0x44C, 'item'], ['Custom design flags', 0x44E, bits(2, [['Wallpaper is a design', 0, 1], ['Flooring is a design', 1, 1], ['Unused', 2, 14]])]] },
    House: { size: 0x15A4, fields: [['Rooms', 0x0, arr(st('Room'), 5, 0x450)], ['Loan', 0x1590, 'u32'], ['K.K. songs', 0x1594, raw(0xC)],
      ['House state', 0x15A0, bits(4, [['Size', 0, 3], ['Size being built', 3, 3], ['Roof color', 6, 4], ['Requested roof', 10, 4], ['Roof after upgrade', 14, 4], ['Lights', 18, 6], ['Counter', 24, 8]])]] },

    NookShop: { size: 0x64, fields: [['Bells spent', 0x0, 'u32'], ['Stock', 0x4, arr('item', 37, 2)], ['Stock date', 0x4E, st('ShopDate')], ['Restock pending', 0x51, 'u8'], ['Point-special day', 0x52, st('ClockDate')], ['Renovation date', 0x56, st('ShopDate')], ['Renovation scheduled', 0x59, 'u8'],
      ['Store state', 0x5A, bits(2, [['Sale hour', 0, 5], ['Next paint', 5, 4], ['Store level', 9, 2], ['Unused', 11, 5]])], ['Sold bits', 0x5C, raw(5)], ['Padding', 0x61, raw(3)]] },
    Museum: { size: 0x64, fields: [['Fossil donors', 0x0, raw(0x1B), 'One nibble per exhibit: 1–4 resident, 5 former resident'], ['Fish donors', 0x1B, raw(0x1D)], ['Bug donors', 0x38, raw(0x1D)], ['Painting donors', 0x55, raw(0xB)], ['Completed on', 0x60, st('ShopDate')], ['Padding', 0x63, 'u8']] },
    TownState: { size: 0x6C, fields: [['Last update', 0x0, st('ClockDate')], ['Native fruit', 0x4, 'fruit'], ['Next week', 0x8, st('ClockDate')], ['Pelican notices posted', 0xC, raw(10), 'Which bulletin-board notices have gone up'], ['Slogans posted', 0x16, raw(11), 'Which town slogans have gone up'], ['Perfect-town streak', 0x21, 's8'], ['Notices started', 0x22, 'u8', '1 once the town hall has posted its first event notices'], ['Padding', 0x23, 'u8'],
      ['Town events', 0x24, arr(st('TownEvent'), 4, 0xC), 'Event 0x63 = free slot'], ['Events updated', 0x54, st('ClockDate')], ['Last play per resident', 0x58, arr(st('ClockDate'), 4, 4)], ['Bulletin board updated', 0x68, st('ClockDate'), 'Day the town hall notices were last posted (TownBbs_UpdateDaily); 0xFF = never']] },
    Contest: { size: 0x38, fields: [['Holder (resident)', 0x0, st('PlayerId')], ['Holder (villager)', 0x16, st('VillagerId')], ['Voted villager', 0x22, st('VillagerId')], ['Winning entry', 0x2E, 'item'], ['Score', 0x30, 's32'], ['Date', 0x34, st('ShopDate')], ['Contest type', 0x37, 'u8', '1 fishing, 2 Bug-Off, 3 Flower Fest']] },
    ReddSale: { size: 0x18, fields: [['Buyer', 0x0, st('PlayerId')], ['Item', 0x16, 'item']] },
    Turnips: { size: 0x1A, fields: [['Week start', 0x0, st('ClockDate')], ['Bought on', 0x4, st('ClockDate')], ['Big-spike price', 0x8, 'u16'], ['Prices (Sun AM … Sat PM)', 0xA, arr('u8', 14, 1)], ['Pattern', 0x18, 'u8'], ['Padding', 0x19, 'u8']] },
    Weather: { size: 0x8, fields: [['Day', 0, 'u8'], ['Month', 1, 'u8'], ['Year', 2, 'u8'], ['Padding', 3, 'u8'], ['Today’s pattern', 4, 'u8'], ['Tomorrow’s pattern', 5, 'u8'], ['Hour base', 6, 's8'], ['Rained', 7, 'u8']] },
    ReddShop: { size: 0x14, fields: [['Stock', 0x0, arr('item', 3, 2)], ['Padding', 0x6, 'u16'], ['Used passwords', 0x8, 'u32'], ['Password slot', 0xC, 's8'], ['Password flags', 0xD, 'u8'], ['Padding', 0xE, 'u16'], ['Sold bits', 0x10, raw(4)]] },
    AbleShop: { size: 0x12, fields: [['Accessories', 0x0, arr('item', 6, 2)], ['Stock date', 0xC, st('ShopDate')], ['Restock pending', 0xF, 'u8'], ['Sold bits', 0x10, raw(2)]] },
    BbsPost: { size: 0xC4, fields: [['Text', 0x0, str(0xC0)], ['Day', 0xC0, 'u8'], ['Month', 0xC1, 'u8'], ['Year', 0xC2, 'u8'], ['Flags', 0xC3, 'u8']] },
    Bbs: { size: 0xB80, fields: [['Posts', 0x0, arr(st('BbsPost'), 15, 0xC4)], ['Notice ID', 0xB7C, 'u16'], ['Post count', 0xB7E, 'u8'], ['Padding', 0xB7F, 'u8']] },
    Constellation: { size: 0x46, fields: [['Creator', 0x0, st('PlayerId')], ['Name', 0x16, str(16)], ['Lines', 0x26, arr('u16', 16, 2)]] },
    Constellations: { size: 0x464, fields: [['Records', 0x0, arr(st('Constellation'), 16, 0x46)], ['Used mask', 0x460, 'u16'], ['New mask', 0x462, 'u16']] },
    Exchange: { size: 0x84C, fields: [['Letter', 0x0, st('Letter')], ['Constellation', 0xF4, st('Constellation')], ['Padding', 0x13A, 'u16'], ['Villager moving in', 0x13C, st('VillagerData')], ['Counter', 0x83C, 'u8'], ['Flags', 0x83D, 'u8'], ['Lost child', 0x83E, st('LostChildRecord')], ['Checksum', 0x84A, 'u16', 'Fixed automatically on save']] },
    Mailbox: { size: 0x98C, fields: [['Letters', 0x0, arr(st('Letter'), 10, 0xF4)], ['Last Wi-Fi mail ID', 0x988, 'u16'], ['Padding', 0x98A, 'u16']] },
    Outbox: { size: 0x990, fields: [['Letters', 0x0, arr(st('Letter'), 10, 0xF4)], ['Last delivery day', 0x988, 'u8'], ['Last delivery month', 0x989, 'u8'], ['Last delivery year', 0x98A, 'u8'], ['Last delivery hour', 0x98B, 'u8'], ['Flags', 0x98C, 'u16'], ['Padding', 0x98E, 'u16']] },
    Blanca: { size: 0x22C, fields: [['Face', 0x0, st('Pattern')], ['Upload checksum', 0x228, 'u16', 'Only used for the old Nintendo Wi-Fi upload'], ['Visit state', 0x22A, 'u8'], ['Concept', 0x22B, 'u8']] },
    Snowman: { size: 6, fields: [['Built on', 0x0, bits(2, [['Year', 0, 7], ['Month', 7, 4], ['Day', 11, 5]])], ['Size and rank', 0x2, bits(2, [['Head size', 0, 7], ['Body size', 7, 7], ['Rank', 14, 2]])], ['Days since built', 0x4, 'u8'], ['Placed in town', 0x5, 'u8']] },
    Villagers: { size: 0x38F4, fields: [['Neighbors', 0x0, arr(st('VillagerData'), 8, 0x700)], ['Friendships (28 pairs)', 0x3800, arr('s8', 28, 1)], ['Outdoor order', 0x381C, arr('s8', 8, 1)], ['Outdoors now', 0x3824, arr('s8', 4, 1)], ['Outdoor reroll', 0x3828, st('DateTime')],
      ['Sick villager', 0x3830, st('SickVillager')], ['Nickname cooldown', 0x38C0, st('ClockDate')], ['Last move-in', 0x38C4, st('DateTime')], ['Last move-out', 0x38CC, st('DateTime')], ['Species history', 0x38D4, arr('u32', 5, 4)],
      ['Last moved-out species', 0x38E8, 's8'], ['Last moved-in index', 0x38E9, 's8'], ['Last sick index', 0x38EA, 's8'], ['Padding', 0x38EB, 'u8'], ['Tune request', 0x38EC, bits(2, [['Unused', 0, 1], ['Requested', 1, 1], ['Requester', 2, 3]])], ['Furniture drop date', 0x38EE, st('ClockDate')], ['Padding', 0x38F2, 'u16']] },
    TownMap: { size: 0x2226, fields: [['Acres', 0x0, arr('acre', 36, 1)], ['Items (16 acres × 256)', 0x24, arr(arr('item', 256, 2), 16, 0x200)], ['Buried masks', 0x2024, arr(raw(0x20), 16, 0x20)], ['Grass', 0x2224, bits(1, [['Grass pattern', 0, 2], ['Ground season', 2, 6]])], ['Padding', 0x2225, 'u8']] },

    SaveData: { size: 0x15FE0, fields: [
      ['Region marker', 0x0, 'u8', '0x8A USA, 0xC5 Europe'], ['Padding', 0x1, 'u8'], ['Town', 0x2, st('TownId')],
      ['Residents', 0xC, arr(st('PlayerData'), 4, 0x228C)], ['Neighbors and villager records', 0x8A3C, st('Villagers')], ['Town map', 0xC330, st('TownMap')],
      ['Gulliver’s UFO quest', 0xE556, bits(1, [['Parts found', 0, 3], ['Started', 3, 1]])], ['The Roost’s guests', 0xE557, bits(1, [['Morning', 0, 1], ['Lunchtime', 1, 3], ['Afternoon', 4, 3], ['Late night', 7, 1]])],
      ['House', 0xE558, st('House')], ['Able Sisters displays', 0xFAFC, arr(st('Pattern'), 8, 0x228)], ['Town exchange (checksummed)', 0x10C3C, st('Exchange')], ['Bulletin board', 0x11488, st('Bbs')], ['Donations total', 0x12008, 's32'],
      ['Home mailboxes', 0x1200C, arr(st('Mailbox'), 4, 0x98C)], ['Letters to deliver', 0x1463C, st('Outbox')], ['Celeste’s constellations', 0x14FCC, st('Constellations')], ['Dressers', 0x15430, arr(arr('item', 90, 2), 4, 0xB4)],
      ['Blanca’s face', 0x15700, st('Blanca')], ['Villager house styles', 0x1592C, arr('u8', 4, 1), '0–24: texture set A–E, variant 0–4'], ['Town flag', 0x15930, st('Pattern')], ['Gate roof', 0x15B58, 'u8'], ['Padding', 0x15B59, raw(3)], ['Message in a bottle', 0x15B5C, st('BottleLetter')],
      ['Received letter (checksummed)', 0x15C58, st('ReceivedLetter')], ['Museum', 0x15D50, st('Museum')], ['Nook’s shop', 0x15DB4, st('NookShop')], ['Weekly visitor schedule', 0x15E18, st('EventWeekSlots')],
      ['Town state', 0x15E54, st('TownState')], ['Lost and found', 0x15EC0, arr('item', 15, 2)], ['Recycling bin', 0x15EDE, arr('item', 15, 2)], ['Tortimer’s contest', 0x15EFC, st('Contest')], ['Crazy Redd’s last sale', 0x15F34, st('ReddSale')],
      ['Turnip market', 0x15F4C, st('Turnips')], ['Weather', 0x15F66, st('Weather')], ['Padding', 0x15F6E, 'u16'], ['Crazy Redd’s shop', 0x15F70, st('ReddShop')], ['Able Sisters’ accessories', 0x15F84, st('AbleShop')], ['Snowmen', 0x15F96, arr(st('Snowman'), 3, 6)],
      ['Town tune', 0x15FA8, raw(8), 'Edit in Town Settings'], ['Happy Room Academy date', 0x15FB0, st('ClockDate')], ['Clock offset', 0x15FB4, st('ClockOffset'), 'Edit in Town Records › Game clock'], ['Item class orders', 0x15FBC, st('ItemClassOrders'), 'Edit in Nook’s › Town rarity ranking'], ['Town founding day', 0x15FC5, st('TownStart')], ['Katie record', 0x15FCA, st('LostChildRecord')], ['Padding', 0x15FD6, 'u16'],
      ['Town event flags', 0x15FD8, raw(4), 'Edit in Town Settings'], ['Checksum', 0x15FDC, 'u16', 'Fixed automatically on save'], ['Save state', 0x15FDE, 'u8', '2 saved properly, 0x1C quit without saving (Mr. Resetti)'], ['Save generation', 0x15FDF, 'u8']] },
  };

  const SIZE = { event: 1, u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, item: 2, species: 1, personality: 1, emotion: 1, acre: 1, fruit: 4 };
  function sizeOf(type) {
    if (typeof type === 'string') return SIZE[type];
    if (type.t === 'str' || type.t === 'bytes') return type.n;
    if (type.t === 'bits') return type.size;
    if (type.t === 'struct') return S[type.s].size;
    if (type.t === 'array') return type.stride * (type.n - 1) + sizeOf(type.of);
    return 0;
  }
  // Checks every struct for overlaps and gaps (development aid; returns problems).
  function validate() {
    const out = [];
    for (const [name, def] of Object.entries(S)) {
      let pos = 0;
      for (const [f, off, type] of [...def.fields].sort((a, b) => a[1] - b[1])) {
        if (off !== pos) out.push(`${name}.${f}: ${off > pos ? 'gap' : 'overlap'} at ${pos.toString(16)} → ${off.toString(16)}`);
        pos = off + sizeOf(type);
      }
      if (pos !== def.size) out.push(`${name}: ends at ${pos.toString(16)}, size ${def.size.toString(16)}`);
    }
    return out;
  }
  // Share of the main block that is typed field by field, and that is raw data with a known purpose.
  function coverage() {
    let typed = 0, known = 0;
    const walk = (type, mult) => {
      if (typeof type === 'string') { typed += SIZE[type] * mult; return; }
      if (type.t === 'str' || type.t === 'bits') { typed += sizeOf(type) * mult; return; }
      if (type.t === 'bytes') { if (type.known) known += type.n * mult; return; }
      if (type.t === 'struct') { for (const [, , t] of S[type.s].fields) walk(t, mult); return; }
      if (type.t === 'array') walk(type.of, mult * type.n);
    };
    walk({ t: 'struct', s: 'SaveData' }, 1);
    return { typed: typed / S.SaveData.size, known: known / S.SaveData.size };
  }

  window.WW_SCHEMA = { S, sizeOf, validate, coverage };
})();
