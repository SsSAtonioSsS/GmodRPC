if not SERVER then return end
local mp = include('libs/sh_messagepack.lua')
local to_hex, from_hex

do
    local byte = string.byte
    local gsub = string.gsub
    local char = string.char
    local format = string.format
    from_hex = function(str) return gsub(str, "..", function(cc) return char(tonumber(cc, 16)) end) end
    to_hex = function(str) return gsub(str, ".", function(c) return format("%02X", byte(c)) end) end
end

local getValues = function(tbl)
    local t = {}
    if table.Count(tbl) <= 0 then return t end
    for _, v in SortedPairs(tbl) do
        table.insert(t, #t + 1, v)
    end

    return t
end

local function unpacknil(t, i, j)
    i = i or 1
    j = j or #t
    v = t[i] ~= "null" and t[i] or nil
    if i <= j then return v, unpacknil(t, i + 1, j) end
end

local sendCB
do
    local web_ip, web_port = "192.168.x.x", 8081 -- Or Global IP
    sendCB = function(uuid, data)
        local inf = {
            uuid = uuid,
            result = data
        }

        HTTP(
            {
                failed = function(err)
                    print(err)
                end,
                success = function(c, b)
                    if c ~= 200 then return print("Error " .. b) end
                end,
                method = "POST",
                url = "http://" .. web_ip .. ":" .. web_port .. "/callback", -- Or use without port
                body = util.TableToJSON(inf),
                type = "application/json",
                headers = {}
            }
        )
    end
end

local function RemoteFunction(p, _, data, _)
    if p:IsValid() then return end
    if table.Count(data) < 2 then return print"uuid function mpargs" end
    local uuid, func, pack = unpack(data)
    local F = _G
    for _, v in pairs(string.Split(func, ".")) do
        if not F[v] then
            F = nil
            break
        end

        F = F[v]
    end

    if type(F) ~= "function" then return sendCB(uuid, tostring(func) .. " not function.") end
    local args = {}
    if pack ~= nil then
        local binary = from_hex(pack)
        local s, err = pcall(
            function()
                args = mp.unpack(binary)
            end
        )

        if not s then
            ErrorNoHaltWithStack(err)
            print("WARNING! Function (" .. func .. ") using without argumets, error unpacking...")
        end
    end

    local viaCallback = tobool(args.viacb)
    args.viacb = nil
    if viaCallback then
        args = getValues(args)
        table.insert(
            args,
            #args + 1,
            function(result)
                if type(result) ~= "table" then
                    result = {
                        result = result
                    }
                end

                sendCB(uuid, result)
            end
        )

        PrintTable(getValues(args))
        F(unpacknil(args))
    else
        local result = F(unpacknil(getValues(args)))
        if type(result) ~= "table" then
            result = {
                result = result
            }
        end

        sendCB(uuid, result)
    end
end

concommand.Add("rfunc", RemoteFunction)
