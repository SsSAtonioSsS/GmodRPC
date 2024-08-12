webluaexec.results = webluaexec.results or {}
function webluaexec.pushResult(uuid, message)
    print(uuid)
    if not istable(message) then return end
    webluaexec.results[uuid] = webluaexec.results[uuid] or {}
    table.insert(webluaexec.results[uuid], message)
end

function webluaexec.getResults(uuid)
    return webluaexec.results[uuid] and webluaexec.results[uuid] or nil
end

function webluaexec.clearResults(uuid)
    if webluaexec.results[uuid] then webluaexec.results[uuid] = nil end
end

local function formatLine(str, line)
    str = string.Split(str, ":")
    local name, line_r = str[1], tonumber(str[2]) - line
    str = table.move(str, 3, #str, 1, {})
    return name .. ":" .. line_r .. ":" .. table.concat(str, ":")
end

local function execRemoteLua(ply, _, args)
    if IsValid(ply) then
        if ply:IsPlayer() then
            ply:ChatPrint("You are not a console!")
        else
            error("Can be runned from console!")
        end
        return
    end

    local uuid = args[1]
    if not uuid or not isstring(uuid) or string.len(uuid) ~= 10 then
        webluaexec.sendCallback(uuid, {
            err = "Uncorrect UUID execlua",
        })
        return error("Uncorrect UUID execlua")
    end

    webluaexec.getLuaData(uuid, function(lua_string)
        if not lua_string or isstring(lua_string) and string.len(lua_string) == 0 then
            webluaexec.sendCallback(uuid, {
                err = "luastring empty"
            })
            return error("luastring empty")
        end

        local printInit = [[local _print, _ptbl = print, PrintTable
            local print, PrintTable = function(...)
                webluaexec.pushResult("]] .. uuid .. [[", {...})
                _print(...)
            end, function(tbl, indent, done)
                webluaexec.pushResult("]] .. uuid .. [[", tbl)
                _ptbl(tbl, indent, done)
            end
            ]]
        local initLen = #string.Split(printInit, "\n") - 1
        local func = CompileString(printInit .. lua_string, nil, false)
        if not isfunction(func) then
            webluaexec.sendCallback(uuid, {
                err = formatLine(func, initLen),
                debug = webluaexec.getResults(uuid)
            })

            webluaexec.clearResults(uuid)
            return error(func)
        end

        local call = {pcall(func)}
        local success, data = call[1], table.move(call, 2, #call, 1, {})
        if success then
            webluaexec.sendCallback(uuid, {
                data = data,
                debug = webluaexec.getResults(uuid)
            })

            webluaexec.clearResults(uuid)
            return
        else
            webluaexec.sendCallback(uuid, {
                err = formatLine(data, initLen),
                debug = webluaexec.getResults(uuid)
            })

            webluaexec.clearResults(uuid)
            return
        end
    end)
end

concommand.Add("execlua", execRemoteLua)